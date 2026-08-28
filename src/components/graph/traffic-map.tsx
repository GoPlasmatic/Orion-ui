import { useCallback, useEffect, useMemo } from "react"
import {
  Background,
  Controls,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Edge,
  type Node,
} from "@xyflow/react"
import { cn } from "@/lib/utils"
import { CLUSTER_HEADER, layoutSystemGraph, type Cluster, type Lane } from "@/lib/map-layout"
import { neighbourhood, type SystemGraph, type SystemNode } from "@/lib/system-graph"
import type { ChannelTraffic, TrafficWindow } from "@/hooks/use-metrics"
import {
  COMPACT_H,
  COMPACT_W,
  NODE_H,
  NODE_W,
  TrafficNode,
  type TrafficNodeData,
} from "@/components/graph/traffic-node"
import {
  deriveLoad,
  dotSize,
  edgeWeight,
  levelFor,
  rawSize,
  type ColorMetric,
  type SizeMetric,
} from "@/lib/traffic-encoding"

const nodeTypes = { channel: TrafficNode, lane: LaneNode, cluster: ClusterNode }

/** Height reserved above each lane for its heading. */
const LANE_HEADER = 40

/**
 * Floor for the initial fit. The map opens showing every channel, so the
 * first frame is an overview: dots and lanes legible, names not necessarily.
 * Zooming in is one scroll; not being able to see the whole system is not.
 */
const FIT_MIN_ZOOM = 0.15

function laneTitle(lane: Lane): { label: string; detail: string } {
  if (lane.tier === 0) {
    return { label: "Entry channels", detail: `${lane.count} · reached over their route` }
  }
  return {
    label: `Called · depth ${lane.tier}`,
    detail: `${lane.count} · reached by channel_call`,
  }
}

/** A lane's heading and backdrop. Drawn under the channels, never interactive. */
function LaneNode({ data }: { data: Record<string, unknown> }) {
  const lane = data.lane as Lane
  const { label, detail } = laneTitle(lane)
  return (
    <div
      style={{ width: lane.width, height: lane.height + LANE_HEADER }}
      className="pointer-events-none flex flex-col"
    >
      <div style={{ height: LANE_HEADER }} className="flex flex-col justify-end px-2 pb-1.5">
        <span className="truncate font-display text-sm font-semibold uppercase leading-tight tracking-wide text-foreground/80">
          {label}
        </span>
        <span className="truncate text-[11px] leading-tight text-muted-foreground">{detail}</span>
      </div>
      <div className="flex-1 rounded-2xl border border-border bg-foreground/[0.04]" />
    </div>
  )
}

/**
 * Entry channels that share one dependency set. The box is the source of the
 * cluster's edges, so eighteen routes that all call one hub draw one line.
 */
function ClusterNode({ data }: { data: Record<string, unknown> }) {
  const cluster = data.cluster as Cluster
  const n = cluster.members.length
  const caption =
    cluster.callees.length > 0
      ? `${n} channels · call ${cluster.callees.join(", ")}`
      : `${n} channels · no calls out`
  return (
    <div
      style={{ width: cluster.width, height: cluster.height }}
      className="pointer-events-none rounded-xl border border-border/80 bg-card/60 shadow-xs"
    >
      <Handle
        type="source"
        position={Position.Right}
        className="!h-1.5 !w-1.5 !border-0 !bg-muted-foreground/50"
      />
      <p
        style={{ height: CLUSTER_HEADER }}
        className="truncate px-3 pt-2 text-[11px] font-medium text-muted-foreground"
        title={caption}
      >
        {caption}
      </p>
    </div>
  )
}

export interface TrafficMapProps {
  graph: SystemGraph
  traffic: TrafficWindow
  visible: Set<string>
  selectedId: string | null
  sizeMetric: SizeMetric
  colorMetric: ColorMetric
  /**
   * Bumped when a selection comes from somewhere other than the canvas — the
   * inspector's caller list, the failing-channel strip. Those can name a node
   * that is off-screen, and selecting something you cannot see reads as the
   * click having done nothing, so the canvas travels to it.
   */
  revealToken: number
  onSelect: (node: SystemNode | null) => void
}

function TrafficMapInner({
  graph,
  traffic,
  visible,
  selectedId,
  sizeMetric,
  colorMetric,
  revealToken,
  onSelect,
}: TrafficMapProps) {
  const { fitView } = useReactFlow()

  const shown = useMemo(
    () => graph.nodes.filter((n) => visible.has(n.id)),
    [graph.nodes, visible],
  )
  const shownEdges = useMemo(
    () => graph.edges.filter((e) => visible.has(e.source) && visible.has(e.target)),
    [graph.edges, visible],
  )

  /**
   * Load including channels the exporter never sees — see deriveLoad. Computed
   * over the whole graph, not just what is visible, so an internal channel keeps
   * its inherited rate when a filter hides the caller it came from.
   */
  const load = useMemo(() => deriveLoad(graph, traffic.byChannel), [graph, traffic.byChannel])

  /**
   * A node is drawn compact when nothing reached it in the window: it is present
   * for context, and giving it the same weight as a channel actually serving
   * requests is exactly the flattening this map exists to undo. Derived load
   * counts — an internal hub is not context, it is the busiest thing here.
   */
  const isCompact = useCallback(
    (id: string) =>
      (traffic.byChannel.get(id)?.windowed ?? 0) === 0 && (load.get(id)?.effective ?? 0) === 0,
    [traffic.byChannel, load],
  )

  /**
   * Layout depends on *structure* only — which nodes, which edges, what size.
   * Traffic numbers change every poll; re-laying out on each one would shuffle
   * the whole canvas under the pointer every ten seconds.
   */
  const layoutKey = useMemo(
    () =>
      JSON.stringify([
        shown.map((n) => [n.id, isCompact(n.id)]),
        shownEdges.map((e) => e.id),
      ]),
    [shown, shownEdges, isCompact],
  )

  const layout = useMemo(
    () =>
      layoutSystemGraph(
        shown.map((n) => ({
          id: n.id,
          width: isCompact(n.id) ? COMPACT_W : NODE_W,
          height: isCompact(n.id) ? COMPACT_H : NODE_H,
          tier: n.tier,
        })),
        shownEdges.map((e) => ({ id: e.id, source: e.source, target: e.target })),
      ),
    [layoutKey], // eslint-disable-line react-hooks/exhaustive-deps
  )

  // Re-frame only when the structure actually changed, so a poll that merely
  // restyles the nodes does not yank the viewport back.
  useEffect(() => {
    const frame = requestAnimationFrame(() =>
      fitView({ padding: 0.06, duration: 400, minZoom: FIT_MIN_ZOOM }),
    )
    return () => cancelAnimationFrame(frame)
  }, [layoutKey]) // eslint-disable-line react-hooks/exhaustive-deps

  // Travel to a node named from outside the canvas, keeping the current zoom so
  // the move reads as a pan rather than a jump.
  useEffect(() => {
    if (!revealToken || !selectedId || !layout.positions.has(selectedId)) return
    fitView({ nodes: [{ id: selectedId }], duration: 500, maxZoom: 1, minZoom: 0.5 })
  }, [revealToken]) // eslint-disable-line react-hooks/exhaustive-deps

  /** Largest value in the current size metric — the top of the scale. */
  const maxSize = useMemo(() => {
    let max = 0
    for (const n of shown) {
      max = Math.max(max, rawSize(sizeMetric, n, traffic.byChannel.get(n.id), load.get(n.id)))
    }
    return max
  }, [shown, sizeMetric, traffic.byChannel, load])

  const rateOf = useCallback(
    (id: string) => load.get(id)?.effective ?? traffic.byChannel.get(id)?.ratePerMin ?? 0,
    [load, traffic.byChannel],
  )

  /** When something is selected, everything outside its blast radius dims. */
  const focusSet = useMemo(
    () => (selectedId && visible.has(selectedId) ? neighbourhood(graph, selectedId) : null),
    [graph, selectedId, visible],
  )

  const nodes = useMemo<Node[]>(() => {
    const lanes: Node[] = layout.lanes.map((lane) => ({
      id: `__lane_${lane.tier}`,
      type: "lane",
      position: { x: lane.x, y: lane.y - LANE_HEADER },
      width: lane.width,
      height: lane.height + LANE_HEADER,
      data: { lane },
      zIndex: -2,
      draggable: false,
      selectable: false,
    }))

    const clusters: Node[] = layout.clusters.map((cluster) => ({
      id: cluster.id,
      type: "cluster",
      position: { x: cluster.x, y: cluster.y },
      width: cluster.width,
      height: cluster.height,
      data: { cluster },
      zIndex: -1,
      draggable: false,
      selectable: false,
      sourcePosition: Position.Right,
    }))

    const channels: Node[] = shown.flatMap((node) => {
      const pos = layout.positions.get(node.id)
      if (!pos) return []
      const compact = isCompact(node.id)
      const channelTraffic: ChannelTraffic | undefined = traffic.byChannel.get(node.id)
      const data: TrafficNodeData = {
        node,
        traffic: channelTraffic,
        level: levelFor(colorMetric, node, channelTraffic),
        dot: dotSize(rawSize(sizeMetric, node, channelTraffic, load.get(node.id)), maxSize),
        load: load.get(node.id),
        compact,
        dimmed: !!focusSet && !focusSet.has(node.id),
        focused: selectedId === node.id,
      }
      return [
        {
          id: node.id,
          type: "channel",
          position: pos,
          width: compact ? COMPACT_W : NODE_W,
          height: compact ? COMPACT_H : NODE_H,
          data: data as unknown as Record<string, unknown>,
          selected: selectedId === node.id,
          sourcePosition: Position.Right,
          targetPosition: Position.Left,
        },
      ]
    })

    return [...lanes, ...clusters, ...channels]
  }, [
    layout,
    shown,
    traffic.byChannel,
    colorMetric,
    sizeMetric,
    maxSize,
    isCompact,
    focusSet,
    selectedId,
    load,
  ])

  /**
   * Edges leave a cluster once per callee rather than once per member; a
   * cluster edge carries the members' summed rate and is in focus when the
   * selection touches any member and the callee.
   */
  const edges = useMemo<Edge[]>(() => {
    const clustered = new Map<string, Cluster>()
    for (const c of layout.clusters) for (const m of c.members) clustered.set(m, c)

    const wanted: { id: string; source: string; target: string; rate: number; inFocus: boolean }[] =
      []
    for (const e of shownEdges) {
      if (clustered.has(e.source)) continue
      wanted.push({
        id: e.id,
        source: e.source,
        target: e.target,
        rate: rateOf(e.source),
        inFocus: !focusSet || (focusSet.has(e.source) && focusSet.has(e.target)),
      })
    }
    for (const c of layout.clusters) {
      const rate = c.members.reduce((sum, m) => sum + rateOf(m), 0)
      for (const target of c.callees) {
        wanted.push({
          id: `${c.id}->${target}`,
          source: c.id,
          target,
          rate,
          inFocus:
            !focusSet || (focusSet.has(target) && c.members.some((m) => focusSet.has(m))),
        })
      }
    }

    const maxRate = Math.max(0, ...wanted.map((w) => w.rate))
    return wanted.map(({ id, source, target, rate, inFocus }) => {
      const hot = rate > 0
      const stroke = inFocus
        ? hot
          ? "var(--primary)"
          : "var(--border-strong)"
        : "var(--border)"
      return {
        id,
        source,
        target,
        type: "smoothstep",
        animated: hot && inFocus,
        style: {
          stroke,
          strokeWidth: edgeWeight(rate, maxRate),
          opacity: inFocus ? (hot ? 1 : 0.6) : 0.15,
        },
        markerEnd: { type: MarkerType.ArrowClosed, color: stroke, width: 14, height: 14 },
      }
    })
  }, [layout, shownEdges, rateOf, focusSet])

  return (
    <div className="relative h-full w-full">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        minZoom={0.1}
        maxZoom={2}
        proOptions={{ hideAttribution: true }}
        nodesConnectable={false}
        nodesDraggable={false}
        elevateNodesOnSelect={false}
        onNodeClick={(_, node) => {
          // Lanes and clusters are nodes too; a click on one is a click on
          // the canvas as far as selection is concerned.
          const data = node.data as unknown as TrafficNodeData
          onSelect(data?.node ?? null)
        }}
        onPaneClick={() => onSelect(null)}
      >
        <Background gap={22} size={1} color="var(--border)" />
        <Controls showInteractive={false} className="!shadow-sm" />
      </ReactFlow>
    </div>
  )
}

export function TrafficMap(props: TrafficMapProps & { className?: string }) {
  const { className, ...rest } = props
  return (
    <div className={cn("h-full w-full", className)}>
      <ReactFlowProvider>
        <TrafficMapInner {...rest} />
      </ReactFlowProvider>
    </div>
  )
}
