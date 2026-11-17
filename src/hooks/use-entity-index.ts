import { useMemo } from "react"
import { useRegistry } from "@/hooks/use-registry"
import { buildIndex } from "@/lib/topology"
import { buildSystemGraph } from "@/lib/system-graph"
import type { Channel, Connector, Workflow } from "@/api/types"

const NONE: never[] = []

type Derived = { index: ReturnType<typeof buildIndex>; graph: ReturnType<typeof buildSystemGraph> }

/**
 * Built once per set of list responses, at module scope: two components on one
 * page (the workflow lenses and a neighbourhood map, say) share the result
 * instead of each building the index and the graph over every channel.
 */
const derived = new WeakMap<object, WeakMap<object, WeakMap<object, Derived>>>()

function derive(channels: Channel[], workflows: Workflow[], connectors: Connector[]): Derived {
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
 * What the head deploys — every channel and workflow — indexed and built into
 * the system graph, once. The map, the dashboard, a detail page's
 * neighbourhood and a connection's dependants all ask the same question.
 * Connectors are 1.x's: until the connection pages land (phase 4) the index
 * carries none, so the graph draws no connector hubs.
 */
export function useEntityIndex() {
  const registry = useRegistry()
  const loaded = !!registry.revision || registry.empty
  const { index, graph } = useMemo(
    () => derive(registry.channels, registry.workflows, NONE),
    [registry.channels, registry.workflows],
  )
  return {
    index,
    graph,
    /** Undefined until the head (and its definitions) have answered. */
    channels: loaded ? registry.channels : undefined,
    workflows: loaded ? registry.workflows : undefined,
    connectors: undefined as Connector[] | undefined,
    /** The channels are the part the graph cannot do without. */
    isLoading: registry.isLoading,
  }
}
