import type { CircuitBreakerStatus, HealthResponse } from "@/api/types"
import type { SystemNode } from "@/lib/system-graph"
import { openBreakers } from "@/lib/breakers"

/**
 * What is broken, keyed the way the map is keyed — by channel name and by
 * connector name — so the canvas can draw it on the node it belongs to.
 *
 * Three sources, none of which is traffic: a connector the engine could not
 * load (`/health`), a channel the engine refused at load (`/health`), and a
 * breaker that has opened on a `channel:connector` pair (this node's breaker
 * map). A channel with an open breaker or a failed connector can look
 * perfectly healthy by its own counters, because the requests that would have
 * hit the connector fail fast or never arrive.
 */
export interface BreakerFault {
  key: string
  connector: string
  state: string
}

export interface MapFaults {
  failedConnectors: Set<string>
  /** Channel name → the engine's reason. */
  quarantined: Map<string, string>
  /** Channel name → the breakers open or half-open on its connectors. */
  breakers: Map<string, BreakerFault[]>
}

export type NodeFaultKind = "quarantined" | "connector" | "breaker"

export interface NodeFault {
  kind: NodeFaultKind
  tone: "destructive" | "warning"
  detail: string
}

export function buildFaults(
  health: HealthResponse | undefined,
  breakers: CircuitBreakerStatus | undefined,
): MapFaults {
  const failedConnectors = new Set(health?.connectors?.failed_to_load ?? [])
  const quarantined = new Map<string, string>()
  for (const q of health?.channels?.quarantined ?? []) quarantined.set(q.channel, q.reason ?? "")
  const byChannel = new Map<string, BreakerFault[]>()
  for (const { key, channel, connector, state } of openBreakers(breakers)) {
    byChannel.set(channel, [...(byChannel.get(channel) ?? []), { key, connector, state }])
  }
  return { failedConnectors, quarantined, breakers: byChannel }
}

/** The faults that touch one node: its own quarantine, its connectors, its breakers. */
export function faultsFor(node: SystemNode, faults: MapFaults): NodeFault[] {
  const out: NodeFault[] = []
  const reason = faults.quarantined.get(node.id)
  if (reason !== undefined) {
    out.push({
      kind: "quarantined",
      tone: "destructive",
      detail: reason || "Refused at load — the route is not being served",
    })
  }
  for (const connector of node.connectors) {
    if (faults.failedConnectors.has(connector)) {
      out.push({
        kind: "connector",
        tone: "destructive",
        detail: `Connector ${connector} failed to load — every task using it is failing`,
      })
    }
  }
  for (const b of faults.breakers.get(node.id) ?? []) {
    out.push({
      kind: "breaker",
      tone: "warning",
      detail: `Circuit breaker ${b.state} on ${b.connector || b.key} · this replica only`,
    })
  }
  return out
}

/** Worst tone among a node's faults, for its border. */
export function worstTone(faults: NodeFault[]): NodeFault["tone"] | null {
  if (faults.some((f) => f.tone === "destructive")) return "destructive"
  if (faults.length > 0) return "warning"
  return null
}
