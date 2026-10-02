import { useMemo } from "react"
import { useChannels } from "@/hooks/use-channels"
import { useWorkflows } from "@/hooks/use-workflows"
import { useConnectors } from "@/hooks/use-connectors"
import { REGISTRY_LIMIT } from "@/lib/use-pagination"
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
 * The whole registry — every channel, workflow and connector — indexed and
 * built into the system graph, once. The map, the dashboard, a detail page's
 * neighbourhood and a connector's dependants all ask the same question, and
 * each used to issue the three list calls and build the graph on its own.
 * The query keys are shared, so TanStack dedupes the requests; this shares
 * the derivation.
 */
export function useEntityIndex() {
  const channels = useChannels({ limit: REGISTRY_LIMIT })
  const workflows = useWorkflows({ limit: REGISTRY_LIMIT })
  const connectors = useConnectors({ limit: REGISTRY_LIMIT })
  const { index, graph } = useMemo(
    () => derive(channels.data?.data ?? NONE, workflows.data?.data ?? NONE, connectors.data?.data ?? NONE),
    [channels.data?.data, workflows.data?.data, connectors.data?.data],
  )
  return {
    index,
    graph,
    channels: channels.data,
    workflows: workflows.data,
    connectors: connectors.data,
    /** The channel list is the one the graph cannot do without. */
    isLoading: channels.isLoading,
  }
}
