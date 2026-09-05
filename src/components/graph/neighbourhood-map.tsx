import { useMemo } from "react"
import { Link, useNavigate } from "react-router"
import { ArrowUpRight } from "lucide-react"
import { useChannels } from "@/hooks/use-channels"
import { useWorkflows } from "@/hooks/use-workflows"
import { useConnectors } from "@/hooks/use-connectors"
import { useChannelTraffic, DEFAULT_TRAFFIC_WINDOW } from "@/hooks/use-metrics"
import { useMapFaults } from "@/hooks/use-faults"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { TrafficMap } from "@/components/graph/traffic-map"
import { buildIndex } from "@/lib/topology"
import { buildSystemGraph, neighbourhood } from "@/lib/system-graph"

export type NeighbourhoodKind = "channel" | "workflow" | "connector"

/**
 * One hop of the System Map around an entity, embedded on its detail page.
 *
 * Replaces the old `RelationshipGraph`: a second graph vocabulary with its own
 * node style, no traffic, no faults and a canvas that could not be panned.
 * This is the same canvas, the same encodings and the same live telemetry as
 * `/system-map`, projected onto the channels within one `channel_call` of
 * the root. Clicking a channel opens it; "Open in System Map" lands on the
 * root with everything else still around it.
 *
 * `id` is the entity's routing id, except for a connector, where it is the
 * connector **name** (references are by name).
 */
export function NeighbourhoodMap({ kind, id }: { kind: NeighbourhoodKind; id: string }) {
  const navigate = useNavigate()
  const { data: channels, isLoading } = useChannels({ limit: 1000 })
  const { data: workflows } = useWorkflows({ limit: 1000 })
  const { data: connectors } = useConnectors({ limit: 1000 })
  const traffic = useChannelTraffic(DEFAULT_TRAFFIC_WINDOW)
  const faults = useMapFaults()

  const graph = useMemo(
    () => buildSystemGraph(buildIndex(channels?.data ?? [], workflows?.data ?? [], connectors?.data ?? [])),
    [channels?.data, workflows?.data, connectors?.data],
  )

  const roots = useMemo(() => {
    switch (kind) {
      case "channel":
        return graph.nodes.filter((n) => n.channelId === id).map((n) => n.id)
      case "workflow":
        return graph.nodes.filter((n) => n.workflowId === id).map((n) => n.id)
      default:
        return graph.nodes.filter((n) => n.connectors.includes(id)).map((n) => n.id)
    }
  }, [graph, kind, id])

  const visible = useMemo(() => {
    const ids = new Set<string>()
    for (const root of roots) for (const n of neighbourhood(graph, root, 1)) ids.add(n)
    return ids
  }, [graph, roots])

  if (isLoading) return <Skeleton className="h-[360px] w-full" />

  if (roots.length === 0) {
    return (
      <div className="rounded-lg border p-8 text-center text-sm text-muted-foreground">
        {kind === "channel"
          ? "This channel is not on the map yet."
          : kind === "workflow"
            ? "No channel runs this workflow, so nothing reaches it and it reaches nothing."
            : "No channel or workflow references this connector."}
      </div>
    )
  }

  const focus = roots.length === 1 ? roots[0] : null
  const what =
    kind === "channel" ? "this channel" : kind === "workflow" ? "the channels running this workflow" : "the channels using this connector"

  return (
    <div className="space-y-2">
      <div className="h-[360px] overflow-hidden rounded-lg border">
        <TrafficMap
          graph={graph}
          traffic={traffic}
          visible={visible}
          selectedId={focus}
          sizeMetric="rate"
          colorMetric="health"
          revealToken={0}
          faults={faults}
          hops={1}
          onSelect={(node) => {
            if (node && !node.unresolved) navigate(`/channels/${node.channelId}`)
          }}
        />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>
          {visible.size} channel{visible.size === 1 ? "" : "s"} within one call of {what} ·
          click one to open it
        </span>
        <Button variant="ghost" size="sm" asChild>
          <Link to={`/system-map?select=${encodeURIComponent(roots[0])}`}>
            Open in System Map <ArrowUpRight className="h-3.5 w-3.5" />
          </Link>
        </Button>
      </div>
    </div>
  )
}
