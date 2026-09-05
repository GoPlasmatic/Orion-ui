import { useCallback, useEffect, useMemo, useState } from "react"
import {
  Background,
  BaseEdge,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
  ReactFlowProvider,
  getSmoothStepPath,
  useReactFlow,
  useStore,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeChange,
} from "@xyflow/react"
import { ChevronsDownUp, ChevronsUpDown } from "lucide-react"
import { cn } from "@/lib/utils"
import { useReducedMotion } from "@/lib/motion"
import { faultsFor, type MapFaults } from "@/lib/faults"
import { CLUSTER_HEADER, layoutSystemGraph, type Cluster, type Lane } from "@/lib/map-layout"
import { neighbourhood, type SystemGraph, type SystemNode } from "@/lib/system-graph"
import type { ChannelTraffic, TrafficWindow } from "@/hooks/use-metrics"
import {
  COMPACT_H,
  COMPACT_W,
  NODE_H,
  NODE_W,
  TrafficNode,
  type LevelOfDetail,
  type TrafficNodeData,
} from "@/components/graph/traffic-node"
import {
  compactNumber,
  deriveLoad,
  dotSize,
  edgeWeight,
  healthDot,
  legendFor,
  levelFor,
  rawSize,
  type ColorMetric,
  type HealthLevel,
  type SizeMetric,
} from "@/lib/traffic-encoding"

const nodeTypes = { channel: TrafficNode, lane: LaneNode, cluster: ClusterNode }
const edgeTypes = { traffic: TrafficEdge }

interface TrafficEdgeData extends Record<string, unknown> {
  /** The hover text: who calls whom, and how much at most. */
  title: string
}

/**
 * A call edge with a native tooltip. No label — sixty labelled edges are
 * noise — but a hover says who calls whom and how much, and why the number is
 * a ceiling: nothing attributes an arrival to a caller, so an edge carries at
 * most the caller's rate. React Flow adds the `animated` class on its wrapper,
 * so the dash animation needs nothing here.
 */
function TrafficEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style,
  markerEnd,
  data,
}: EdgeProps) {
  const [path] = getSmoothStepPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition })
  const title = (data as TrafficEdgeData | undefined)?.title
  return (
    <g>
      {title && <title>{title}</title>}
      <BaseEdge id={id} path={path} style={style} markerEnd={markerEnd} />
    </g>
  )
}

/** Height reserved above each lane for its heading. */
const LANE_HEADER = 40

/**
 * Floor for the initial fit. The map opens showing every channel, so the
 * first frame is an overview: dots and lanes legible, names not necessarily.
 * Zooming in is one scroll; not being able to see the whole system is not.
 */
const FIT_MIN_ZOOM = 0.15

/**
 * Channels on the canvas before a minimap earns its corner. Below this the
 * overview fit already shows everything; above it the operator is zoomed in
 * on one lane and needs to know where the rest went.
 */
const MINIMAP_AT = 15

/**
 * Below this zoom a node stops trying to be a card and becomes a dot with a
 * name large enough to survive the scale. The card's footprint does not change
 * — the layout is zoom-independent — only what is drawn inside it.
 */
const LOD_ZOOM = 0.55

/**
 * Clusters collapse to one summary box by default only when the map is big
 * enough for it to matter and the cluster is a real crowd. On an eleven-channel
 * system a collapsed cluster would hide most of the map.
 */
const COLLAPSE_MAP_AT = 30
const COLLAPSE_CLUSTER_AT = 6

const LEVEL_RANK: Record<HealthLevel, number> = { idle: 0, healthy: 1, notice: 2, warning: 3, critical: 4 }

function laneTitle(lane: Lane): { label: string; detail: string } {
  if (lane.tier === 0) {
    return { label: "Entry channels", detail: `${lane.count} · reached over a route or by a schedule` }
  }
  return {
    label: `Internal · ${lane.tier} hop${lane.tier === 1 ? "" : "s"} in`,
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

interface ClusterNodeData extends Record<string, unknown> {
  cluster: Cluster
  /** Summed rate of the members, for the collapsed summary. */
  rate: number
  /** Worst member health, for the collapsed summary. */
  level: HealthLevel
  /** How many members carry a fault. */
  faulted: number
  dimmed: boolean
}

/**
 * Entry channels that share one dependency set. The box is the source of the
 * cluster's edges, so eighteen routes that all call one hub draw one line.
 * Collapsed, it is one summary node; a click toggles.
 */
function ClusterNode({ data }: { data: Record<string, unknown> }) {
  const { cluster, rate, level, faulted, dimmed } = data as ClusterNodeData
  const n = cluster.members.length
  const caption =
    cluster.callees.length > 0
      ? `${n} channels · call ${cluster.callees.join(", ")}`
      : `${n} channels · no calls out`
  if (cluster.collapsed) {
    return (
      <div
        style={{ width: cluster.width, height: cluster.height }}
        className={cn(
          "flex cursor-pointer items-center gap-3 rounded-xl border bg-card px-3 shadow-xs transition-opacity hover:border-border-strong",
          dimmed && "opacity-30",
        )}
        title={`${caption} · click to expand`}
      >
        <Handle
          type="source"
          position={Position.Right}
          className="!h-1.5 !w-1.5 !border-0 !bg-muted-foreground/50"
        />
        <span className="relative flex h-9 w-9 shrink-0 items-center justify-center">
          <span className={cn("absolute inset-0 rounded-full opacity-20", healthDot[level])} />
          <span className={cn("h-6 w-6 rounded-full ring-2 ring-border", healthDot[level])} />
          <span className="absolute -right-1 -top-1 rounded-full bg-muted px-1 font-mono text-[10px] tabular-nums text-foreground">
            {n}
          </span>
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-semibold leading-tight">
            {n} entry channels
          </p>
          <p className="truncate text-[11px] text-muted-foreground">
            {cluster.callees.length > 0 ? `call ${cluster.callees.join(", ")}` : "no calls out"}
          </p>
          <p className="flex items-center gap-2 font-mono text-[10px] tabular-nums text-muted-foreground">
            {rate > 0 ? `${compactNumber(rate)}/m together` : "idle"}
            {faulted > 0 && <span className="text-destructive">{faulted} faulted</span>}
          </p>
        </div>
        <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
      </div>
    )
  }
  return (
    <div
      style={{ width: cluster.width, height: cluster.height }}
      className={cn(
        "cursor-pointer rounded-xl border border-border/80 bg-card/60 shadow-xs transition-opacity hover:border-border-strong",
        dimmed && "opacity-30",
      )}
      title={`${caption} · click the frame to collapse`}
    >
      <Handle
        type="source"
        position={Position.Right}
        className="!h-1.5 !w-1.5 !border-0 !bg-muted-foreground/50"
      />
      <p
        style={{ height: CLUSTER_HEADER }}
        className="flex items-center gap-1.5 truncate px-3 pt-2 text-[11px] font-medium text-muted-foreground"
      >
        <span className="truncate">{caption}</span>
        <ChevronsDownUp className="ml-auto h-3 w-3 shrink-0" aria-hidden />
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
  /** Quarantines, failed connectors and open breakers, drawn on the nodes they touch. */
  faults: MapFaults
  /** How far the focus dims from the selection: call hops, or every reachable channel. */
  hops: number
  /**
   * Search hits: everything else dims rather than disappears, so the canvas
   * holds still while a name is typed. Null when nothing is being searched.
   */
  highlight?: ReadonlySet<string> | null
  /** A cron channel's next fire, by channel name, for its card. */
  nextFire: ReadonlyMap<string, string>
}

/** Lanes and clusters are frames on the minimap; channels are the marks. */
const minimapClass = (n: Node) => (n.type === "channel" ? "map-mini-channel" : "map-mini-frame")

function TrafficMapInner({
  graph,
  traffic,
  visible,
  selectedId,
  sizeMetric,
  colorMetric,
  revealToken,
  onSelect,
  faults,
  hops,
  highlight = null,
  nextFire,
}: TrafficMapProps) {
  const { fitView } = useReactFlow()
  // A boolean selector: the component re-renders when the level of detail
  // flips, not on every frame of a pan or zoom.
  const dotLod = useStore((s) => s.transform[2] < LOD_ZOOM)
  const lod: LevelOfDetail = dotLod ? "dot" : "full"
  const reducedMotion = useReducedMotion()
  /** What each colour slot means under the current metric, for the node's label. */
  const legendLabel = useMemo(
    () => new Map(legendFor(colorMetric).map((entry) => [entry.level, entry.label])),
    [colorMetric],
  )

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
   *
   * With hysteresis: a channel that carried anything across the whole metrics
   * buffer stays expanded, whatever the window says. Without it a channel that
   * goes quiet for one window shrank back, every lane below it moved, and on
   * a bursty system the canvas shuffled on the ten-second poll.
   */
  const isCompact = useCallback(
    (id: string) =>
      (traffic.byChannel.get(id)?.windowed ?? 0) === 0 &&
      (load.get(id)?.effective ?? 0) === 0 &&
      !traffic.activeInBuffer.has(id),
    [traffic.byChannel, traffic.activeInBuffer, load],
  )

  /**
   * Which clusters are collapsed: the operator's toggles, over a default that
   * collapses crowds on a big map. A cluster holding the selection is always
   * open — a `?select=` link must land on a visible node.
   */
  const [clusterOverrides, setClusterOverrides] = useState<ReadonlyMap<string, boolean>>(
    () => new Map(),
  )
  const isCollapsed = useCallback(
    (clusterId: string, members: string[]) => {
      if (selectedId && members.includes(selectedId)) return false
      const override = clusterOverrides.get(clusterId)
      if (override !== undefined) return override
      return shown.length > COLLAPSE_MAP_AT && members.length >= COLLAPSE_CLUSTER_AT
    },
    [clusterOverrides, selectedId, shown.length],
  )

  /**
   * Layout depends on *structure* only — which nodes, which edges, what size,
   * which clusters are folded. Traffic numbers change every poll; re-laying out
   * on each one would shuffle the whole canvas under the pointer.
   */
  const layoutKey = useMemo(
    () =>
      JSON.stringify([
        shown.map((n) => [n.id, isCompact(n.id)]),
        shownEdges.map((e) => e.id),
        [...clusterOverrides.entries()],
        selectedId,
      ]),
    [shown, shownEdges, isCompact, clusterOverrides, selectedId],
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
        { isCollapsed, collapsedWidth: NODE_W, collapsedHeight: NODE_H },
      ),
    [layoutKey], // eslint-disable-line react-hooks/exhaustive-deps
  )

  /** Members folded into a collapsed cluster are not drawn. */
  const folded = useMemo(() => {
    const ids = new Set<string>()
    for (const c of layout.clusters) if (c.collapsed) for (const m of c.members) ids.add(m)
    return ids
  }, [layout.clusters])

  // Re-frame only when the *set of channels* changed — a filter, a new
  // channel — never when a node merely grew because traffic reached it. The
  // layout still re-runs for the size change; the viewport stays put.
  const fitKey = useMemo(() => shown.map((n) => n.id).join("|"), [shown])
  useEffect(() => {
    const frame = requestAnimationFrame(() =>
      fitView({ padding: 0.06, duration: reducedMotion ? 0 : 400, minZoom: FIT_MIN_ZOOM }),
    )
    return () => cancelAnimationFrame(frame)
  }, [fitKey]) // eslint-disable-line react-hooks/exhaustive-deps

  // Travel to a node named from outside the canvas, keeping the current zoom so
  // the move reads as a pan rather than a jump. Scheduled a frame later, like
  // the overview fit above, so that when both fire on the same render — the
  // page opened on `?select=` — this one runs second and wins.
  useEffect(() => {
    if (!revealToken || !selectedId || !layout.positions.has(selectedId)) return
    const frame = requestAnimationFrame(() =>
      fitView({
        nodes: [{ id: selectedId }],
        duration: reducedMotion ? 0 : 500,
        maxZoom: 1,
        minZoom: 0.5,
      }),
    )
    return () => cancelAnimationFrame(frame)
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

  /**
   * When something is selected, everything outside its blast radius dims. One
   * hop by default: in a connected system "everything reachable" dims nothing.
   */
  const focusSet = useMemo(
    () => (selectedId && visible.has(selectedId) ? neighbourhood(graph, selectedId, hops) : null),
    [graph, selectedId, visible, hops],
  )

  /** Lit: inside the selection's blast radius (if any) and a search hit (if any). */
  const lit = useCallback(
    (id: string) => (!focusSet || focusSet.has(id)) && (!highlight || highlight.has(id)),
    [focusSet, highlight],
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

    const clusters: Node[] = layout.clusters.map((cluster) => {
      let rate = 0
      let level: HealthLevel = "idle"
      let faulted = 0
      for (const m of cluster.members) {
        rate += rateOf(m)
        const node = graph.byId.get(m)
        if (!node) continue
        const l = levelFor(colorMetric, node, traffic.byChannel.get(m))
        if (LEVEL_RANK[l] > LEVEL_RANK[level]) level = l
        if (faultsFor(node, faults).length > 0) faulted++
      }
      const data: ClusterNodeData = {
        cluster,
        rate,
        level,
        faulted,
        dimmed: !cluster.members.some(lit),
      }
      return {
        id: cluster.id,
        type: "cluster",
        position: { x: cluster.x, y: cluster.y },
        width: cluster.width,
        height: cluster.height,
        data,
        zIndex: cluster.collapsed ? 0 : -1,
        draggable: false,
        selectable: false,
        sourcePosition: Position.Right,
      }
    })

    const channels: Node[] = shown.flatMap((node) => {
      if (folded.has(node.id)) return []
      const pos = layout.positions.get(node.id)
      if (!pos) return []
      const compact = isCompact(node.id)
      const channelTraffic: ChannelTraffic | undefined = traffic.byChannel.get(node.id)
      const level = levelFor(colorMetric, node, channelTraffic)
      const healthLabel = legendLabel.get(level) ?? level
      const data: TrafficNodeData = {
        node,
        traffic: channelTraffic,
        level,
        healthLabel,
        dot: dotSize(rawSize(sizeMetric, node, channelTraffic, load.get(node.id)), maxSize),
        load: load.get(node.id),
        compact,
        dimmed: !lit(node.id),
        focused: selectedId === node.id,
        faults: faultsFor(node, faults),
        lod,
        nextFire: nextFire.get(node.id) ?? null,
      }
      return [
        {
          id: node.id,
          type: "channel",
          position: pos,
          width: compact ? COMPACT_W : NODE_W,
          height: compact ? COMPACT_H : NODE_H,
          data,
          selected: selectedId === node.id,
          // Colour alone is what the dot says at overview zoom; the name the
          // wrapper announces carries the same reading in words.
          ariaLabel: `${node.name}, ${healthLabel}`,
          sourcePosition: Position.Right,
          targetPosition: Position.Left,
        },
      ]
    })

    return [...lanes, ...clusters, ...channels]
  }, [
    layout,
    shown,
    folded,
    traffic.byChannel,
    colorMetric,
    sizeMetric,
    maxSize,
    isCompact,
    lit,
    selectedId,
    load,
    faults,
    graph.byId,
    rateOf,
    lod,
    legendLabel,
    nextFire,
  ])

  /**
   * Edges leave a cluster once per callee rather than once per member; a
   * cluster edge carries the members' summed rate and is in focus when the
   * selection touches any member and the callee.
   */
  const edges = useMemo<Edge[]>(() => {
    const clustered = new Map<string, Cluster>()
    for (const c of layout.clusters) for (const m of c.members) clustered.set(m, c)

    const wanted: {
      id: string
      source: string
      target: string
      rate: number
      inFocus: boolean
      title: string
    }[] = []
    const bound = (rate: number) =>
      rate > 0 ? `≤ ${compactNumber(rate)}/m` : "no traffic in the window"
    for (const e of shownEdges) {
      if (clustered.has(e.source)) continue
      const rate = rateOf(e.source)
      wanted.push({
        id: e.id,
        source: e.source,
        target: e.target,
        rate,
        inFocus: lit(e.source) && lit(e.target),
        title: `${e.source} → ${e.target} · ${bound(rate)} — at most the caller's rate; an arrival is not attributed to a caller`,
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
          inFocus: lit(target) && c.members.some(lit),
          title: `${c.members.length} channels → ${target} · ${bound(rate)} — the callers' rates summed`,
        })
      }
    }

    const maxRate = Math.max(0, ...wanted.map((w) => w.rate))
    return wanted.map(({ id, source, target, rate, inFocus, title }) => {
      const hot = rate > 0
      const stroke = inFocus
        ? hot
          ? "var(--primary)"
          : "var(--border-strong)"
        : "var(--border)"
      const data: TrafficEdgeData = { title }
      return {
        id,
        source,
        target,
        type: "traffic",
        data,
        // Motion only where the eye should go: the selection's own edges — and
        // none at all when the OS asks for less of it.
        animated: hot && inFocus && !!focusSet && !reducedMotion,
        style: {
          stroke,
          strokeWidth: edgeWeight(rate, maxRate),
          opacity: inFocus ? (hot ? 1 : 0.6) : 0.15,
        },
        markerEnd: { type: MarkerType.ArrowClosed, color: stroke, width: 14, height: 14 },
      }
    })
  }, [layout, shownEdges, rateOf, focusSet, lit, reducedMotion])

  /**
   * Keyboard selection. A focused node selects on Enter or Space and clears
   * on Escape — React Flow reports that here, not through onNodeClick. A
   * mouse click reaches both paths with the same answer.
   */
  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      let picked: SystemNode | null | undefined
      for (const change of changes) {
        if (change.type !== "select") continue
        if (change.selected) {
          const node = graph.byId.get(change.id)
          if (node) picked = node
        } else if (picked === undefined) {
          picked = null
        }
      }
      if (picked !== undefined) onSelect(picked)
    },
    [graph.byId, onSelect],
  )
  const onNodeClick = useCallback(
    (_: unknown, node: Node) => {
      if (node.type === "cluster") {
        // A cluster toggles rather than selects.
        const cluster = (node.data as ClusterNodeData).cluster
        setClusterOverrides((prev) => new Map(prev).set(cluster.id, !cluster.collapsed))
        return
      }
      // Lanes are nodes too; a click on one is a click on the canvas as far
      // as selection is concerned.
      onSelect((node.data as TrafficNodeData).node ?? null)
    },
    [onSelect],
  )
  const onPaneClick = useCallback(() => onSelect(null), [onSelect])

  return (
    <div className="relative h-full w-full">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        minZoom={0.1}
        maxZoom={2}
        proOptions={{ hideAttribution: true }}
        nodesConnectable={false}
        nodesDraggable={false}
        elevateNodesOnSelect={false}
        onNodesChange={onNodesChange}
        onNodeClick={onNodeClick}
        onPaneClick={onPaneClick}
      >
        <Background gap={22} size={1} color="var(--border)" />
        <Controls showInteractive={false} className="!shadow-sm" />
        {shown.length > MINIMAP_AT && (
          // Lanes and clusters are nodes too; drawn as faint frames so the
          // minimap reads as columns rather than as a wall of rectangles. The
          // colours live in index.css — a `fill` attribute does not resolve a
          // CSS variable, a stylesheet rule does.
          <MiniMap
            pannable
            zoomable
            nodeClassName={minimapClass}
            aria-label="Map overview"
          />
        )}
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
