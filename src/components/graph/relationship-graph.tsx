import { useMemo } from "react"
import { useNavigate } from "react-router"
import { useChannels } from "@/hooks/use-channels"
import { useWorkflows } from "@/hooks/use-workflows"
import { useConnectors } from "@/hooks/use-connectors"
import { Skeleton } from "@/components/ui/skeleton"
import { TopologyGraph } from "@/components/graph/topology-graph"
import {
  buildIndex,
  buildChannelTopology,
  buildWorkflowNeighborhood,
  buildConnectorNeighborhood,
  type NodeKind,
  type TopoNode,
} from "@/lib/topology"

// Embedded local-neighborhood graph for a detail page. `id` is the entity's
// routing id, except for connectors where it is the connector NAME (references
// are by name).
export function RelationshipGraph({ kind, id }: { kind: NodeKind; id: string }) {
  const navigate = useNavigate()
  const { data: channels, isLoading } = useChannels({ limit: 1000 })
  const { data: workflows } = useWorkflows({ limit: 1000 })
  const { data: connectors } = useConnectors({ limit: 1000 })

  const idx = useMemo(
    () => buildIndex(channels?.data ?? [], workflows?.data ?? [], connectors?.data ?? []),
    [channels?.data, workflows?.data, connectors?.data],
  )

  const model = useMemo(() => {
    if (kind === "channel") return buildChannelTopology(id, idx)
    if (kind === "workflow") return buildWorkflowNeighborhood(id, idx)
    return buildConnectorNeighborhood(id, idx)
  }, [kind, id, idx])

  const onNodeClick = (node: TopoNode) => {
    if (node.unresolved) return
    navigate(
      node.kind === "channel"
        ? `/channels/${node.refId}`
        : node.kind === "workflow"
          ? `/workflows/${node.refId}`
          : `/connectors/${node.refId}`,
    )
  }

  if (isLoading) return <Skeleton className="h-[300px] w-full" />

  if (model.nodes.length <= 1) {
    return (
      <div className="rounded-lg border p-8 text-center text-sm text-muted-foreground">
        No related channels, workflows, or connectors found.
      </div>
    )
  }

  return (
    <div className="rounded-lg border">
      <TopologyGraph model={model} height={300} interactive={false} onNodeClick={onNodeClick} />
    </div>
  )
}
