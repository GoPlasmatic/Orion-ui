import { flattenSteps } from "@/lib/workflow-steps"
import type { Channel, Workflow, Connector } from "@/api/types"

// Pure entity indexing and reference extraction. Operates on already-fetched
// entity lists (no React, no fetching) so it can be memoized. The graph built
// on top of it lives in lib/system-graph.ts; the detail pages embed a one-hop
// projection of that same graph (components/graph/neighbourhood-map.tsx).

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
 * (`GET admin/functions`).
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
 *
 * Since 1.5 `channel` is JSONLogic: a literal string is the static case, and
 * an object is a target computed per message (the old `channel_logic` spelling
 * is an accepted alias for the same thing). A computed target is unknowable
 * here, so it is skipped — `GET admin/workflows/{id}/dependencies` reports
 * `has_dynamic_channel_calls` for exactly that case.
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

/** Whether any `channel_call` computes its target rather than naming it. */
export function hasDynamicChannelCalls(workflow: Workflow): boolean {
  for (const task of flattenSteps(workflow.tasks)) {
    if (task.function?.name !== "channel_call") continue
    const input = task.function.input ?? {}
    if (input.channel !== undefined && typeof input.channel !== "string") return true
    if (input.channel_logic !== undefined) return true
  }
  return false
}
