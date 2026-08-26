import { flattenSteps } from "@/lib/workflow-steps"
import type { Channel, Workflow, Connector, EntityStatus } from "@/api/types"

// Pure relationship-graph builder. Operates on already-fetched entity lists (no
// React, no fetching) so it can be memoized and reused by the System Map and the
// per-detail-page mini-graphs.

export type NodeKind = "channel" | "workflow" | "connector"
export type EdgeKind = "runs" | "calls" | "uses"

export interface TopoNode {
  id: string // namespaced: "channel:<id>" | "workflow:<id>" | "connector:<id-or-name>"
  kind: NodeKind
  label: string
  refId: string // raw id for routing (channel_id / workflow_id / connector uuid or name)
  depth: number
  status?: EntityStatus // channel / workflow lifecycle
  enabled?: boolean // connector
  unresolved?: boolean // referenced by name but not found in the fetched set
}

export interface TopoEdge {
  id: string
  source: string
  target: string
  kind: EdgeKind
}

export interface TopoModel {
  nodes: TopoNode[]
  edges: TopoEdge[]
}

export interface EntityIndex {
  channelsById: Map<string, Channel>
  channelsByName: Map<string, Channel>
  workflowsById: Map<string, Workflow>
  connectorsByName: Map<string, Connector>
}

/**
 * Task functions that reference an external connector, and the input keys a
 * connector name might live under. Untyped on the wire — best-effort, tunable
 * here.
 *
 * This is the *bulk* path, used by the system map and the reverse
 * connector→workflow sweep, which need every workflow at once. For a single
 * workflow prefer `GET admin/workflows/{id}/dependencies`
 * (`workflowsApi.dependencies`): the server walks the real tasks, so it cannot
 * drift from this list, and it also reports `has_dynamic_channel_calls`, which
 * static parsing cannot see.
 *
 * Keep in sync with the connector functions in the server's function registry
 * (`GET admin/functions`, rendered on /functions).
 */
const CONNECTOR_FUNCTIONS = new Set([
  "http_call",
  "data_query",
  "data_write",
  "db_read",
  "db_write",
  "cache_read",
  "cache_write",
  "mongo_read",
  "mongo_write",
  "mongo_aggregate",
  "publish_kafka",
  "send_email",
  "storage_presign",
  "storage_head",
])
const CONNECTOR_KEYS = ["connector", "connector_name", "connector_id"]

export function buildIndex(
  channels: Channel[],
  workflows: Workflow[],
  connectors: Connector[],
): EntityIndex {
  const channelsById = new Map<string, Channel>()
  const channelsByName = new Map<string, Channel>()
  for (const c of channels) {
    channelsById.set(c.channel_id, c)
    channelsByName.set(c.name, c)
  }
  const workflowsById = new Map<string, Workflow>()
  for (const w of workflows) workflowsById.set(w.workflow_id, w)
  const connectorsByName = new Map<string, Connector>()
  for (const c of connectors) connectorsByName.set(c.name, c)
  return { channelsById, channelsByName, workflowsById, connectorsByName }
}

export function channelConnectorRefs(channel: Channel): string[] {
  const names = new Set<string>()
  const cache = channel.config?.cache?.connector
  const dedup = channel.config?.deduplication?.connector
  if (cache) names.add(cache)
  if (dedup) names.add(dedup)
  return [...names]
}

function connectorNameFromInput(input?: Record<string, unknown>): string | undefined {
  if (!input) return undefined
  for (const key of CONNECTOR_KEYS) {
    const v = input[key]
    if (typeof v === "string") return v
  }
  return undefined
}

export function workflowConnectorRefs(workflow: Workflow): string[] {
  const names = new Set<string>()
  // `flattenSteps` descends into task groups. Iterating `tasks` directly would
  // miss every task inside a guard clause — a connector referenced only from
  // one would render as unreferenced on the system map and survive the
  // connector-deletion reverse sweep.
  for (const task of flattenSteps(workflow.tasks)) {
    if (!task.function || !CONNECTOR_FUNCTIONS.has(task.function.name)) continue
    const name = connectorNameFromInput(task.function.input)
    if (name) names.add(name)
  }
  return [...names]
}

/**
 * Channel names targeted by `channel_call` tasks.
 *
 * These are **names**, not `channel_id`s — `input.channel` names the channel the
 * way an author writes it. Resolving one therefore goes through
 * `channelsByName`; looking it up in `channelsById` (a UUID map on a real
 * server) silently misses every time.
 */
export function channelCallTargets(workflow: Workflow): string[] {
  const targets: string[] = []
  for (const task of flattenSteps(workflow.tasks)) {
    if (task.function?.name !== "channel_call") continue
    const target = task.function.input?.channel
    if (typeof target === "string") targets.push(target)
  }
  return targets
}

export function findChannelsUsingWorkflow(workflowId: string, idx: EntityIndex): Channel[] {
  return [...idx.channelsById.values()].filter((c) => c.workflow_id === workflowId)
}

export function findReferencesToConnector(
  connectorName: string,
  idx: EntityIndex,
): { channels: Channel[]; workflows: Workflow[] } {
  const channels = [...idx.channelsById.values()].filter((c) =>
    channelConnectorRefs(c).includes(connectorName),
  )
  const workflows = [...idx.workflowsById.values()].filter((w) =>
    workflowConnectorRefs(w).includes(connectorName),
  )
  return { channels, workflows }
}

// ---- model assembly helpers ----

class ModelBuilder {
  nodes = new Map<string, TopoNode>()
  edges = new Map<string, TopoEdge>()

  addNode(node: TopoNode) {
    if (!this.nodes.has(node.id)) this.nodes.set(node.id, node)
  }

  addEdge(source: string, target: string, kind: EdgeKind) {
    const id = `${kind}:${source}->${target}`
    if (!this.edges.has(id)) this.edges.set(id, { id, source, target, kind })
  }

  model(): TopoModel {
    return { nodes: [...this.nodes.values()], edges: [...this.edges.values()] }
  }
}

function channelNode(channel: Channel | undefined, channelId: string, depth: number): TopoNode {
  const id = `channel:${channelId}`
  if (!channel) return { id, kind: "channel", label: channelId, refId: channelId, depth, unresolved: true }
  return { id, kind: "channel", label: channel.name, refId: channel.channel_id, depth, status: channel.status }
}

function workflowNode(workflow: Workflow | undefined, workflowId: string, depth: number): TopoNode {
  const id = `workflow:${workflowId}`
  if (!workflow) return { id, kind: "workflow", label: workflowId, refId: workflowId, depth, unresolved: true }
  return { id, kind: "workflow", label: workflow.name, refId: workflow.workflow_id, depth, status: workflow.status }
}

function connectorNode(name: string, idx: EntityIndex, depth: number): TopoNode {
  const conn = idx.connectorsByName.get(name)
  if (!conn) return { id: `connector:name:${name}`, kind: "connector", label: name, refId: name, depth, unresolved: true }
  return { id: `connector:${conn.id}`, kind: "connector", label: conn.name, refId: conn.id, depth, enabled: conn.enabled }
}

// Forward walk from a single channel: channel → workflow → channel_call targets
// (recursively) → connectors. BFS with a visited-set on channel ids guards cycles.
export function buildChannelTopology(rootChannelId: string, idx: EntityIndex): TopoModel {
  const b = new ModelBuilder()
  const visited = new Set<string>()
  const queue: { channelId: string; depth: number }[] = [{ channelId: rootChannelId, depth: 0 }]

  while (queue.length) {
    const { channelId, depth } = queue.shift()!
    if (visited.has(channelId)) continue
    visited.add(channelId)

    const channel = idx.channelsById.get(channelId)
    const chNode = channelNode(channel, channelId, depth)
    b.addNode(chNode)
    if (!channel) continue

    for (const name of channelConnectorRefs(channel)) {
      const node = connectorNode(name, idx, depth + 1)
      b.addNode(node)
      b.addEdge(chNode.id, node.id, "uses")
    }

    if (channel.workflow_id) {
      const wf = idx.workflowsById.get(channel.workflow_id)
      const wfNode = workflowNode(wf, channel.workflow_id, depth + 1)
      b.addNode(wfNode)
      b.addEdge(chNode.id, wfNode.id, "runs")

      if (wf) {
        for (const name of workflowConnectorRefs(wf)) {
          const node = connectorNode(name, idx, depth + 2)
          b.addNode(node)
          b.addEdge(wfNode.id, node.id, "uses")
        }
        for (const target of channelCallTargets(wf)) {
          // `target` is a channel NAME. Feeding it to the id-keyed queue made
          // every call target resolve to `undefined`, render as a dashed
          // "missing" node, and stop the walk one hop in — so a map of a
          // channel that calls others showed neither the callee nor anything
          // beyond it.
          const callee = idx.channelsByName.get(target)
          const node = channelNode(callee, callee?.channel_id ?? target, depth + 2)
          b.addNode(node)
          b.addEdge(wfNode.id, node.id, "calls")
          if (callee) queue.push({ channelId: callee.channel_id, depth: depth + 2 })
        }
      }
    }
  }

  return b.model()
}

// Local neighborhood for a workflow detail page: parent channel(s) → this
// workflow → its connectors + channel_call targets (no deep recursion).
export function buildWorkflowNeighborhood(workflowId: string, idx: EntityIndex): TopoModel {
  const b = new ModelBuilder()
  const wf = idx.workflowsById.get(workflowId)
  const wfNode = workflowNode(wf, workflowId, 1)
  b.addNode(wfNode)

  for (const channel of findChannelsUsingWorkflow(workflowId, idx)) {
    const chNode = channelNode(channel, channel.channel_id, 0)
    b.addNode(chNode)
    b.addEdge(chNode.id, wfNode.id, "runs")
  }

  if (wf) {
    for (const name of workflowConnectorRefs(wf)) {
      const node = connectorNode(name, idx, 2)
      b.addNode(node)
      b.addEdge(wfNode.id, node.id, "uses")
    }
    for (const target of channelCallTargets(wf)) {
      // Targets are names — see channelCallTargets.
      const callee = idx.channelsByName.get(target)
      const node = channelNode(callee, callee?.channel_id ?? target, 2)
      b.addNode(node)
      b.addEdge(wfNode.id, node.id, "calls")
    }
  }

  return b.model()
}

// Local neighborhood for a connector detail page: every channel/workflow that
// references this connector → the connector (reverse lookup).
export function buildConnectorNeighborhood(connectorName: string, idx: EntityIndex): TopoModel {
  const b = new ModelBuilder()
  const node = connectorNode(connectorName, idx, 1)
  b.addNode(node)

  const { channels, workflows } = findReferencesToConnector(connectorName, idx)
  for (const channel of channels) {
    const chNode = channelNode(channel, channel.channel_id, 0)
    b.addNode(chNode)
    b.addEdge(chNode.id, node.id, "uses")
  }
  for (const workflow of workflows) {
    const wfNode = workflowNode(workflow, workflow.workflow_id, 0)
    b.addNode(wfNode)
    b.addEdge(wfNode.id, node.id, "uses")
  }

  return b.model()
}
