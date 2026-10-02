import { useMemo } from "react"
import { Link, useNavigate } from "react-router"
import { ArrowUpRight } from "lucide-react"
import { useEntityIndex } from "@/hooks/use-entity-index"
import { useChannelTraffic, DEFAULT_TRAFFIC_WINDOW } from "@/hooks/use-metrics"
import { useMapTelemetry } from "@/hooks/use-faults"
import { useConnectorTraffic } from "@/hooks/use-ops-metrics"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { TrafficMap } from "@/components/graph/traffic-map"
import { DependencyMap } from "@/components/graph/dependency-map"
import { neighbourhood } from "@/lib/system-graph"
import { buildDependencyGraph, hubId, parseHubId } from "@/lib/dependency-graph"

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
 * When nothing is within a call of the root — the common case on a system
 * whose channels coordinate through shared connectors — a lone node says
 * nothing, so the view becomes one hop of the dependencies lens instead: the
 * root channels and the connectors, plugins and models they depend on, as
 * hubs.
 *
 * `id` is the entity's routing id, except for a connector, where it is the
 * connector **name** (references are by name).
 */
export function NeighbourhoodMap({ kind, id }: { kind: NeighbourhoodKind; id: string }) {
  const navigate = useNavigate()
  const { graph, index, isLoading } = useEntityIndex()
  const traffic = useChannelTraffic(DEFAULT_TRAFFIC_WINDOW)
  const connectorTraffic = useConnectorTraffic(DEFAULT_TRAFFIC_WINDOW)
  const { faults, nextFire } = useMapTelemetry(graph)

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

  // No call neighbour anywhere: draw dependencies rather than a lone node.
  const dependencyView = roots.length > 0 && visible.size === roots.length
  const measuredKey = useMemo(
    () => (dependencyView ? [...connectorTraffic.byEdge.keys()].sort().join("\n") : ""),
    [dependencyView, connectorTraffic.byEdge],
  )
  const dg = useMemo(() => {
    if (!dependencyView) return null
    const measured = measuredKey
      ? measuredKey.split("\n").map((k) => {
          const bar = k.indexOf("|")
          return [k.slice(0, bar), k.slice(bar + 1)] as const
        })
      : []
    return buildDependencyGraph(graph, index, {
      visible: new Set(roots),
      measured,
      includeUnused: false,
    })
  }, [dependencyView, graph, index, roots, measuredKey])

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

  if (dg) {
    // A connector's page centres on the connector, lit with everything leaning on it.
    const selected = kind === "connector" ? hubId("connector", id) : focus
    const hubs = dg.hubs.length
    return (
      <div className="space-y-2">
        <div className="h-[360px] overflow-hidden rounded-lg border">
          <DependencyMap
            graph={graph}
            dg={dg}
            traffic={traffic}
            connectorTraffic={connectorTraffic}
            selectedId={selected}
            sizeMetric="rate"
            colorMetric="health"
            faults={faults}
            revealToken={0}
            expandAll={kind !== "connector"}
            onSelect={(target) => {
              if (!target) return
              const hub = parseHubId(target)
              if (hub) {
                const h = dg.hubById.get(target)
                if (!h?.known) return
                navigate(
                  hub.kind === "connector"
                    ? `/connectors/${h.refId}`
                    : `/${hub.kind}s/${encodeURIComponent(h.refId)}`,
                )
                return
              }
              const node = graph.byId.get(target)
              if (node && !node.unresolved) navigate(`/channels/${node.channelId}`)
            }}
          />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
          <span>
            No channel calls or is called by {what}, so this shows what{" "}
            {roots.length === 1 ? "it depends" : "they depend"} on — {hubs} shared dependenc
            {hubs === 1 ? "y" : "ies"} · click one to open it
          </span>
          <Button variant="ghost" size="sm" asChild>
            <Link
              to={`/system-map?lens=deps&select=${encodeURIComponent(selected ?? roots[0])}`}
            >
              Open in System Map <ArrowUpRight className="h-3.5 w-3.5" />
            </Link>
          </Button>
        </div>
      </div>
    )
  }

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
          nextFire={nextFire}
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
