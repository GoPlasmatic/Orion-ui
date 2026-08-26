import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  Background,
  Controls,
  MarkerType,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Edge,
  type Node,
} from "@xyflow/react"
import { Loader2 } from "lucide-react"
import { cn } from "@/lib/utils"
import { layoutSystemGraph, type Placement } from "@/lib/elk-layout"
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

const nodeTypes = { channel: TrafficNode, band: BandLabel }

/**
 * Floor for the initial fit. Below roughly this, a node is a coloured smudge:
 * better to open legible and let the operator pan (or use the minimap) than to
 * fit everything on screen and make none of it readable.
 */
const FIT_MIN_ZOOM = 0.42

/** Divider announcing the packed grid of channels that no call reaches. */
function BandLabel({ data }: { data: Record<string, unknown> }) {
  return (
    <div className="pointer-events-none w-[560px] border-t pt-2">
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {String(data.label)}
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
  const [positions, setPositions] = useState<Map<string, Placement>>(new Map())
  const [bandY, setBandY] = useState<number | null>(null)
  const [detachedCount, setDetachedCount] = useState(0)
  const [laidOut, setLaidOut] = useState(false)

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
   * Traffic numbers change every poll; re-running ELK on each one would shuffle
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

  const lastKey = useRef<string>("")
  useEffect(() => {
    let cancelled = false
    const inputs = shown.map((n) => ({
      id: n.id,
      width: isCompact(n.id) ? COMPACT_W : NODE_W,
      height: isCompact(n.id) ? COMPACT_H : NODE_H,
    }))
    layoutSystemGraph(
      inputs,
      shownEdges.map((e) => ({ id: e.id, source: e.source, target: e.target })),
    )
      .then((result) => {
        if (cancelled) return
        setPositions(result.positions)
        setBandY(result.detachedBandY)
        setDetachedCount(result.detachedCount)
        setLaidOut(true)
        // Re-frame only when the structure actually changed, so a poll that
        // merely restyles the nodes does not yank the viewport back.
        if (lastKey.current !== layoutKey) {
          lastKey.current = layoutKey
          requestAnimationFrame(() =>
            fitView({ padding: 0.18, duration: 400, minZoom: FIT_MIN_ZOOM }),
          )
        }
      })
      .catch(() => {
        if (!cancelled) setLaidOut(true)
      })
    return () => {
      cancelled = true
    }
  }, [layoutKey]) // eslint-disable-line react-hooks/exhaustive-deps

  // Travel to a node named from outside the canvas, keeping the current zoom so
  // the move reads as a pan rather than a jump.
  useEffect(() => {
    if (!revealToken || !selectedId || !positions.has(selectedId)) return
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

  const maxRate = useMemo(() => {
    let max = 0
    for (const l of load.values()) max = Math.max(max, l.effective ?? 0)
    return max
  }, [load])

  /** When something is selected, everything outside its blast radius dims. */
  const focusSet = useMemo(
    () => (selectedId && visible.has(selectedId) ? neighbourhood(graph, selectedId) : null),
    [graph, selectedId, visible],
  )

  const nodes = useMemo<Node[]>(() => {
    const out: Node[] = shown.flatMap((node) => {
      const pos = positions.get(node.id)
      if (!pos) return []
      const channelTraffic: ChannelTraffic | undefined = traffic.byChannel.get(node.id)
      const data: TrafficNodeData = {
        node,
        traffic: channelTraffic,
        level: levelFor(colorMetric, node, channelTraffic),
        dot: dotSize(rawSize(sizeMetric, node, channelTraffic, load.get(node.id)), maxSize),
        load: load.get(node.id),
        compact: isCompact(node.id),
        dimmed: !!focusSet && !focusSet.has(node.id),
        focused: selectedId === node.id,
      }
      return [
        {
          id: node.id,
          type: "channel",
          position: pos,
          data: data as unknown as Record<string, unknown>,
          selected: selectedId === node.id,
          sourcePosition: Position.Right,
          targetPosition: Position.Left,
        },
      ]
    })

    if (bandY != null && detachedCount > 0) {
      out.push({
        id: "__band__",
        type: "band",
        position: { x: 0, y: bandY - 34 },
        data: {
          label: `${detachedCount} channel${detachedCount === 1 ? "" : "s"} not reached by any call`,
        },
        draggable: false,
        selectable: false,
      })
    }
    return out
  }, [
    shown,
    positions,
    traffic.byChannel,
    colorMetric,
    sizeMetric,
    maxSize,
    isCompact,
    focusSet,
    selectedId,
    bandY,
    detachedCount,
    load,
  ])

  const edges = useMemo<Edge[]>(
    () =>
      shownEdges.map((e) => {
        const rate = load.get(e.source)?.effective ?? traffic.byChannel.get(e.source)?.ratePerMin ?? 0
        const inFocus = !focusSet || (focusSet.has(e.source) && focusSet.has(e.target))
        const hot = rate > 0
        const stroke = inFocus
          ? hot
            ? "var(--primary)"
            : "var(--border-strong)"
          : "var(--border)"
        return {
          id: e.id,
          source: e.source,
          target: e.target,
          type: "smoothstep",
          animated: hot && inFocus,
          style: {
            stroke,
            strokeWidth: edgeWeight(rate, maxRate),
            opacity: inFocus ? 1 : 0.15,
          },
          markerEnd: { type: MarkerType.ArrowClosed, color: stroke, width: 14, height: 14 },
        }
      }),
    [shownEdges, traffic.byChannel, maxRate, focusSet, load],
  )

  return (
    <div className="relative h-full w-full">
      {!laidOut && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-card/60 backdrop-blur-sm">
          <span className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Laying out {shown.length} channels…
          </span>
        </div>
      )}
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
          const data = node.data as unknown as TrafficNodeData
          if (data?.node) onSelect(data.node)
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
