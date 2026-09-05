import { useMemo } from "react"
import { useChannels } from "@/hooks/use-channels"
import { useWorkflows } from "@/hooks/use-workflows"
import { useConnectors } from "@/hooks/use-connectors"
import { REGISTRY_LIMIT } from "@/lib/use-pagination"
import { buildIndex } from "@/lib/topology"
import { buildSystemGraph } from "@/lib/system-graph"

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
  const index = useMemo(
    () => buildIndex(channels.data?.data ?? [], workflows.data?.data ?? [], connectors.data?.data ?? []),
    [channels.data?.data, workflows.data?.data, connectors.data?.data],
  )
  const graph = useMemo(() => buildSystemGraph(index), [index])
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
