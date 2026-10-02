import { useCallback, useEffect, useMemo, useState } from "react"
import {
  Background,
  BaseEdge,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  getBezierPath,
  useReactFlow,
  useStore,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeChange,
} from "@xyflow/react"
import { cn } from "@/lib/utils"
import { useReducedMotion } from "@/lib/motion"
import { middleTruncate, shortName } from "@/lib/domains"
import { faultsFor, type MapFaults } from "@/lib/faults"
import {
  dependencyEdges,
  dependencyFocus,
  domainLoad,
  edgeLoad,
  hubLevel,
  layoutDependencies,
  type DependencyGraph,
} from "@/lib/dependency-graph"
import type { SystemGraph } from "@/lib/system-graph"
import type { TrafficWindow } from "@/hooks/use-metrics"
import type { ConnectorTrafficWindow } from "@/hooks/use-ops-metrics"
import {
  compactNumber,
  deriveLoad,
  errorLevel,
  formatPct,
  healthStroke,
  levelFor,
  rawSize,
  sqrtScale,
  worstLevel,
  type ColorMetric,
  type SizeMetric,
} from "@/lib/traffic-encoding"
import { pinTitle, type ChangePins } from "@/components/graph/change-pins"
import { FitControl } from "@/components/graph/map-controls"
import { fitOptions } from "@/components/graph/map-fit"
import {
  DEP_CHANNEL_H,
  DEP_CHANNEL_W,
  DOMAIN_H,
  DOMAIN_W,
  DepChannelNode,
  DomainNode,
  HUB_H,
  HUB_W,
  HubNode,
  type DepChannelNodeData,
  type DomainNodeData,
  type HubNodeData,
} from "@/components/graph/dependency-nodes"

const nodeTypes = { domain: DomainNode, depChannel: DepChannelNode, hub: HubNode }
const edgeTypes = { dependency: DependencyEdge }

/** Same thresholds as the calls lens: a big map opens with its crowds folded. */
const COLLAPSE_MAP_AT = 30
const COLLAPSE_DOMAIN_AT = 6
const LOD_ZOOM = 0.55
const MINIMAP_AT = 15
/** Label budget of a channel card inside an open domain. */
const CHANNEL_CHARS = { full: 20, dot: 15 }

interface DependencyEdgeData extends Record<string, unknown> {
  title: string
}

function DependencyEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, style, data }: EdgeProps) {
  const [path] = getBezierPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition })
  const title = (data as DependencyEdgeData | undefined)?.title
  return (
    <g>
      {title && <title>{title}</title>}
      <BaseEdge id={id} path={path} style={style} />
    </g>
  )
}

export interface DependencyMapProps {
  graph: SystemGraph
  dg: DependencyGraph
  traffic: TrafficWindow
  connectorTraffic: ConnectorTrafficWindow
  /** A channel name or a hub id. */
  selectedId: string | null
  sizeMetric: SizeMetric
  colorMetric: ColorMetric
  faults: MapFaults
  pins?: ChangePins
  /** Search hits — channel names and hub ids. Null when nothing is searched. */
  highlight?: ReadonlySet<string> | null
  /** Bumped when a selection arrives from outside the canvas; the canvas travels to it. */
  revealToken: number
  /** Open every domain whatever its size — the detail pages' one-hop view. */
  expandAll?: boolean
  onSelect: (id: string | null) => void
}

const minimapClass = (n: Node) => (n.type === "domain" ? "map-mini-frame" : "map-mini-channel")

function DependencyMapInner({
  graph,
  dg,
  traffic,
  connectorTraffic,
  selectedId,
  sizeMetric,
  colorMetric,
  faults,
  pins,
  highlight = null,
  revealToken,
  expandAll = false,
  onSelect,
}: DependencyMapProps) {
  const { fitView } = useReactFlow()
  const reducedMotion = useReducedMotion()
  const dotLod = useStore((s) => s.transform[2] < LOD_ZOOM)
  const lod = dotLod ? "dot" : "full"

  const channelCount = useMemo(() => dg.domains.reduce((n, d) => n + d.members.length, 0), [dg.domains])
  const selectedDomain = selectedId ? (dg.domainOf.get(selectedId) ?? null) : null

  const [overrides, setOverrides] = useState<ReadonlyMap<string, boolean>>(() => new Map())
  const isExpanded = useCallback(
    (id: string) => {
      if (id === selectedDomain) return true
      const o = overrides.get(id)
      if (o !== undefined) return o
      if (expandAll) return true
      const size = dg.domains.find((d) => d.id === id)?.members.length ?? 0
      return !(channelCount > COLLAPSE_MAP_AT && size >= COLLAPSE_DOMAIN_AT)
    },
    [overrides, selectedDomain, expandAll, dg.domains, channelCount],
  )
  const onToggle = useCallback(
    (id: string) => setOverrides((prev) => new Map(prev).set(id, !isExpanded(id))),
    [isExpanded],
  )

  // Structure only: traffic changes every poll and must not move a box.
  const expandedKey = dg.domains.map((d) => (isExpanded(d.id) ? "1" : "0")).join("")
  const layout = useMemo(
    () =>
      layoutDependencies(dg, isExpanded, {
        domain: { width: DOMAIN_W, height: DOMAIN_H },
        channel: { width: DEP_CHANNEL_W, height: DEP_CHANNEL_H },
        hub: { width: HUB_W, height: HUB_H },
      }),
    [dg, expandedKey], // eslint-disable-line react-hooks/exhaustive-deps
  )
  const depEdges = useMemo(
    () => dependencyEdges(dg, isExpanded),
    [dg, expandedKey], // eslint-disable-line react-hooks/exhaustive-deps
  )

  // Frame on open, when the set in view changes, and after a domain folds or opens.
  const fitKey = `${channelCount}|${dg.hubs.length}|${dg.domains.map((d) => d.id).join(",")}|${[...overrides.entries()].join(";")}`
  useEffect(() => {
    const frame = requestAnimationFrame(() => fitView(fitOptions(reducedMotion)))
    return () => cancelAnimationFrame(frame)
  }, [fitKey]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!revealToken || !selectedId || !layout.positions.has(selectedId)) return
    const frame = requestAnimationFrame(() =>
      fitView({ nodes: [{ id: selectedId }], duration: reducedMotion ? 0 : 500, maxZoom: 1, minZoom: 0.5 }),
    )
    return () => cancelAnimationFrame(frame)
  }, [revealToken]) // eslint-disable-line react-hooks/exhaustive-deps

  const load = useMemo(() => deriveLoad(graph, traffic.byChannel), [graph, traffic.byChannel])
  const maxSize = useMemo(() => {
    let max = 0
    for (const d of dg.domains) {
      for (const m of d.members) {
        const node = graph.byId.get(m)
        if (node) max = Math.max(max, rawSize(sizeMetric, node, traffic.byChannel.get(m), load.get(m)))
      }
    }
    return max
  }, [dg.domains, graph.byId, sizeMetric, traffic.byChannel, load])

  const focus = useMemo(
    () => (selectedId && (dg.hubById.has(selectedId) || dg.domainOf.has(selectedId)) ? dependencyFocus(dg, selectedId) : null),
    [dg, selectedId],
  )
  const lit = useCallback(
    (id: string) => (!focus || focus.has(id)) && (!highlight || highlight.has(id)),
    [focus, highlight],
  )
  const selectedHub = selectedId ? (dg.hubById.get(selectedId) ?? null) : null
  const hubDependants = useMemo(() => new Set(selectedHub?.dependants ?? []), [selectedHub])

  const nodes = useMemo<Node[]>(() => {
    const out: Node[] = []
    for (const box of layout.domains) {
      const domain = dg.domains.find((d) => d.id === box.id)!
      let faulted = 0
      let changed = 0
      const levels = domain.members.map((m) => {
        const node = graph.byId.get(m)
        if (node && faultsFor(node, faults).length > 0) faulted++
        if (pins?.get(m)?.length) changed++
        return node ? levelFor(colorMetric, node, traffic.byChannel.get(m)) : "idle"
      })
      const data: DomainNodeData = {
        domain,
        title: domain.name,
        expanded: box.expanded,
        width: box.width,
        height: box.height,
        load: domainLoad(domain.members, traffic.byChannel),
        level: worstLevel(levels),
        faulted,
        changed,
        dependOn: selectedHub ? domain.members.filter((m) => hubDependants.has(m)).length : null,
        dimmed: !domain.members.some(lit),
        onToggle,
      }
      out.push({
        id: box.id,
        type: "domain",
        position: { x: box.x, y: box.y },
        width: box.width,
        height: box.height,
        data,
        zIndex: box.expanded ? -1 : 0,
        draggable: false,
        selectable: false,
        focusable: false,
      })
      if (!box.expanded) continue
      for (const m of domain.members) {
        const pos = layout.positions.get(m)
        const node = graph.byId.get(m)
        if (!pos || !node) continue
        const t = traffic.byChannel.get(m)
        const short = shortName(m, dg.domainIndex)
        const cd: DepChannelNodeData = {
          id: m,
          label: middleTruncate(short, lod === "dot" ? CHANNEL_CHARS.dot : CHANNEL_CHARS.full),
          title: `${m}${t?.ratePerMin ? ` · ${compactNumber(t.ratePerMin)}/m` : ""}${t?.errorPct != null ? ` · ${formatPct(t.errorPct)} err` : ""}`,
          level: levelFor(colorMetric, node, t),
          dot: sqrtScale(rawSize(sizeMetric, node, t, load.get(m)), maxSize, 7, 18),
          ratePerMin: t?.ratePerMin ?? null,
          faults: faultsFor(node, faults),
          pin: pinTitle(pins?.get(m)),
          dimmed: !lit(m),
          focused: selectedId === m,
          lod,
        }
        out.push({
          id: m,
          type: "depChannel",
          position: pos,
          width: DEP_CHANNEL_W,
          height: DEP_CHANNEL_H,
          data: cd,
          selected: selectedId === m,
          ariaLabel: `${m}, channel in ${domain.name}`,
        })
      }
    }
    const windowed = connectorTraffic.state === "live"
    for (const hub of dg.hubs) {
      const pos = layout.positions.get(hub.id)
      if (!pos) continue
      const ct = hub.kind === "connector" ? connectorTraffic.byConnector.get(hub.name) : undefined
      const failed = hub.kind === "connector" ? (faults.failedConnectors.get(hub.name) ?? null) : null
      const data: HubNodeData = {
        hub,
        traffic: ct,
        level: hubLevel(colorMetric, hub, ct, failed != null),
        failedToLoad: failed,
        windowed,
        dimmed: !lit(hub.id),
        focused: selectedId === hub.id,
      }
      out.push({
        id: hub.id,
        type: "hub",
        position: pos,
        width: HUB_W,
        height: HUB_H,
        data,
        selected: selectedId === hub.id,
        ariaLabel: `${hub.name}, ${hub.type ?? hub.kind}, ${hub.dependants.length} dependants`,
      })
    }
    return out
  }, [
    layout,
    dg,
    graph.byId,
    faults,
    pins,
    colorMetric,
    sizeMetric,
    traffic.byChannel,
    connectorTraffic,
    selectedHub,
    hubDependants,
    lit,
    onToggle,
    load,
    maxSize,
    selectedId,
    lod,
  ])

  const edges = useMemo<Edge[]>(() => {
    const loads = depEdges.map((e) => {
      const hub = dg.hubById.get(e.target)!
      return { e, hub, l: edgeLoad(e.channels, hub, connectorTraffic.byEdge) }
    })
    const maxCalls = Math.max(0, ...loads.map((x) => x.l.calls))
    const span = traffic.spanLabel
    return loads.map(({ e, hub, l }) => {
      const sourceName = e.channels.length === 1 && e.source === e.channels[0] ? e.source : `${e.channels.length} channels in ${dg.domainIndex.domainOf.get(e.channels[0]) ?? "this domain"}`
      const inFocus = lit(e.target) && (e.source.startsWith("domain:") ? e.channels.some(lit) : lit(e.source))
      const stroke = !l.measured
        ? "var(--border-strong)"
        : colorMetric === "health" && l.errorPct != null
          ? healthStroke[errorLevel(l.errorPct)]
          : "var(--primary)"
      const title = l.measured
        ? `${sourceName} → ${hub.name} · ${compactNumber(l.calls)} call${l.calls === 1 ? "" : "s"} ${l.windowed ? `in the ${span}` : "since the server started"}${l.errorPct != null ? ` · ${formatPct(l.errorPct)} errors` : ""}`
        : `${sourceName} → ${hub.name} · referenced by the workflow${hub.kind === "connector" ? `; no calls measured (${span})` : ""}`
      const data: DependencyEdgeData = { title }
      return {
        id: e.id,
        source: e.source,
        target: e.target,
        type: "dependency",
        data,
        style: {
          stroke,
          strokeWidth: l.measured ? sqrtScale(l.calls, maxCalls, 1.5, 8) : 1,
          strokeDasharray: l.measured ? undefined : "4 4",
          opacity: inFocus ? (l.measured ? 0.85 : 0.7) : 0.1,
        },
      }
    })
  }, [depEdges, dg, connectorTraffic.byEdge, traffic.spanLabel, colorMetric, lit])

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      let picked: string | null | undefined
      for (const change of changes) {
        if (change.type !== "select") continue
        if (change.selected) picked = change.id
        else if (picked === undefined) picked = null
      }
      if (picked !== undefined) onSelect(picked)
    },
    [onSelect],
  )
  const onNodeClick = useCallback(
    (_: unknown, node: Node) => {
      // A domain's own button folds and opens it.
      if (node.type === "domain") return
      onSelect(node.id)
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
        <Controls showInteractive={false} showFitView={false} className="!shadow-sm" />
        <FitControl />
        {nodes.length > MINIMAP_AT && (
          <MiniMap pannable zoomable nodeClassName={minimapClass} aria-label="Map overview" />
        )}
      </ReactFlow>
    </div>
  )
}

export function DependencyMap(props: DependencyMapProps & { className?: string }) {
  const { className, ...rest } = props
  return (
    <div className={cn("h-full w-full", className)}>
      <ReactFlowProvider>
        <DependencyMapInner {...rest} />
      </ReactFlowProvider>
    </div>
  )
}
