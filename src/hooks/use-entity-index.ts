import { useMemo } from "react"
import { useRegistry } from "@/hooks/use-registry"
import { buildIndex, type ConnectorRef } from "@/lib/topology"
import { useConnections, useProviderResolver } from "@/hooks/use-connections"
import { buildSystemGraph } from "@/lib/system-graph"
import type { Channel, Workflow } from "@/api/types"

type Derived = { index: ReturnType<typeof buildIndex>; graph: ReturnType<typeof buildSystemGraph> }

/**
 * Built once per set of list responses, at module scope: two components on one
 * page (the workflow lenses and a neighbourhood map, say) share the result
 * instead of each building the index and the graph over every channel.
 */
const derived = new WeakMap<object, WeakMap<object, WeakMap<object, Derived>>>()

function derive(channels: Channel[], workflows: Workflow[], connectors: ConnectorRef[]): Derived {
  let a = derived.get(channels)
  if (!a) derived.set(channels, (a = new WeakMap()))
  let b = a.get(workflows)
  if (!b) a.set(workflows, (b = new WeakMap()))
  let hit = b.get(connectors)
  if (!hit) {
    const index = buildIndex(channels, workflows, connectors)
    hit = { index, graph: buildSystemGraph(index) }
    b.set(connectors, hit)
  }
  return hit
}

/**
 * What the head deploys — every channel, workflow and connection — indexed
 * and built into the system graph, once. The map, the dashboard, a detail
 * page's neighbourhood and a connection's dependants all ask the same
 * question. A connection the head deploys is `enabled`; one only stored is
 * known but not serving.
 */
export function useEntityIndex() {
  const registry = useRegistry()
  const connections = useConnections()
  const provider = useProviderResolver()
  const refs = useMemo<ConnectorRef[]>(
    () =>
      connections.data.map((c) => ({
        id: c.connection_id,
        name: c.connection_id,
        connector_type: provider((c.deployed ?? c.latest).provider_digest).family,
        enabled: !!c.deployed,
      })),
    [connections.data, provider],
  )
  const loaded = !!registry.revision || registry.empty
  const { index, graph } = useMemo(
    () => derive(registry.channels, registry.workflows, refs),
    [registry.channels, registry.workflows, refs],
  )
  return {
    index,
    graph,
    /** Undefined until the head (and its definitions) have answered. */
    channels: loaded ? registry.channels : undefined,
    workflows: loaded ? registry.workflows : undefined,
    connections: connections.isLoading ? undefined : connections.data,
    /** The channels are the part the graph cannot do without. */
    isLoading: registry.isLoading,
  }
}
