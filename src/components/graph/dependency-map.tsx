import { useCallback, useMemo, useState } from "react"
import {
  Background,
  BaseEdge,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  getBezierPath,
  useStore,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeChange,
} from "@xyflow/react"
import { cn, plural } from "@/lib/utils"
import { middleTruncate, shortName } from "@/lib/domains"
import { faultsFor, type MapFaults, type NodeFault } from "@/lib/faults"
import {
  dependencyEdges,
  dependencyFocus,
  domainIdOf,
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
  deriveLoad,
  errorLevel,
  formatPct,
  healthStroke,
  levelFor,
  rawSize,
  sqrtScale,
  trafficLine,
  worstLevel,
  type ColorMetric,
  type SizeMetric,
} from "@/lib/traffic-encoding"
import { pinTitle, type ChangePins } from "@/lib/change-pins"
import { FitControl } from "@/components/graph/map-controls"
import { COLLAPSE_CLUSTER_AT, COLLAPSE_MAP_AT, LOD_ZOOM, MINIMAP_AT } from "@/lib/map-fit"
import { useMapFraming } from "@/components/graph/use-map-framing"
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
  const dotLod = useStore((s) => s.transform[2] < LOD_ZOOM)
  const lod = dotLod ? "dot" : "full"

  const domainsById = useMemo(() => new Map(dg.domains.map((d) => [d.id, d])), [dg.domains])
  const channelCount = useMemo(() => dg.domains.reduce((n, d) => n + d.members.length, 0), [dg.domains])
  const selectedDomain = selectedId ? (domainIdOf(dg, selectedId) ?? null) : null

  /**
   * Which domains are open: the operator's toggles, over a default that folds
   * crowds on a big map (the calls lens's thresholds). The domain holding the
   * selection is always open — a `?select=` link must land on a visible node.
   * Structure only: traffic changes every poll and must not move a box.
   */
  const [overrides, setOverrides] = useState<ReadonlyMap<string, boolean>>(() => new Map())
  const expanded = useMemo(() => {
    const crowded = channelCount > COLLAPSE_MAP_AT
    const out = new Set<string>()
    for (const d of dg.domains) {
      const override = overrides.get(d.id)
      const open =
        d.id === selectedDomain ||
        (override ?? (expandAll || !(crowded && d.members.length >= COLLAPSE_CLUSTER_AT)))
      if (open) out.add(d.id)
    }
    return out
  }, [dg.domains, overrides, selectedDomain, expandAll, channelCount])
  const isExpanded = useCallback((id: string) => expanded.has(id), [expanded])
  const onToggle = useCallback(
    (id: string) => setOverrides((prev) => new Map(prev).set(id, !expanded.has(id))),
    [expanded],
  )

  const layout = useMemo(
    () =>
      layoutDependencies(dg, isExpanded, {
        domain: { width: DOMAIN_W, height: DOMAIN_H },
        channel: { width: DEP_CHANNEL_W, height: DEP_CHANNEL_H },
        hub: { width: HUB_W, height: HUB_H },
      }),
    [dg, isExpanded],
  )
  const depEdges = useMemo(() => dependencyEdges(dg, isExpanded), [dg, isExpanded])

  // Frame on open, when the set in view changes, and after a domain folds or
  // opens; travel to a selection named from outside the canvas.
  const fitKey = `${channelCount}|${dg.hubs.length}|${dg.domains.map((d) => d.id).join(",")}|${[...overrides.entries()].join(";")}`
  useMapFraming(fitKey, revealToken, selectedId, !!selectedId && layout.positions.has(selectedId))

  /** Each channel's faults, once per change of the fault overlay. */
  const channelFaults = useMemo(() => {
    const out = new Map<string, NodeFault[]>()
    for (const d of dg.domains) {
      for (const m of d.members) {
        const node = graph.byId.get(m)
        if (node) out.set(m, faultsFor(node, faults))
      }
    }
    return out
  }, [dg.domains, graph.byId, faults])

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
    () =>
      selectedId && (dg.hubById.has(selectedId) || dg.domainIndex.domainOf.has(selectedId))
        ? dependencyFocus(dg, selectedId)
        : null,
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
      const domain = domainsById.get(box.id)
      if (!domain) continue
      let faulted = 0
      let changed = 0
      const levels = domain.members.map((m) => {
        const node = graph.byId.get(m)
        if ((channelFaults.get(m)?.length ?? 0) > 0) faulted++
        if (pins?.get(m)?.length) changed++
        return node ? levelFor(colorMetric, node, traffic.byChannel.get(m)) : "idle"
      })
      const data: DomainNodeData = {
        domain,
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
          title: t && t.windowed > 0 ? `${m} · ${trafficLine(t)}` : m,
          level: levelFor(colorMetric, node, t),
          dot: sqrtScale(rawSize(sizeMetric, node, t, load.get(m)), maxSize, 7, 18),
          ratePerMin: t?.ratePerMin ?? null,
          faults: channelFaults.get(m) ?? [],
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
    const windowed = connectorTraffic.spanSec > 0
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
    domainsById,
    channelFaults,
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

  const hasWindow = connectorTraffic.spanSec > 0
  const edges = useMemo<Edge[]>(() => {
    const loads = depEdges.map((e) => {
      const hub = dg.hubById.get(e.target)!
      return { e, hub, l: edgeLoad(e.channels, hub, connectorTraffic.byEdge, hasWindow) }
    })
    const maxCalls = Math.max(0, ...loads.map((x) => x.l.calls))
    const span = traffic.spanLabel
    return loads.map(({ e, hub, l }) => {
      const sourceName = e.channels.length === 1 && e.source === e.channels[0] ? e.source : `${e.channels.length} channels in ${dg.domainIndex.domainOf.get(e.channels[0]) ?? "this domain"}`
      const inFocus = lit(e.target) && (e.source.startsWith("domain:") ? e.channels.some(lit) : lit(e.source))
      // Three readings: carrying calls (width and colour), measured but idle
      // in the window (a thin solid line), and a static reference the
      // exporter has never counted (thin and dashed).
      const busy = l.measured && l.calls > 0
      const stroke = !busy
        ? healthStroke.idle
        : colorMetric === "health" && l.errorPct != null
          ? healthStroke[errorLevel(l.errorPct)]
          : "var(--primary)"
      const title = busy
        ? `${sourceName} → ${hub.name} · ${plural(l.calls, "call")} ${l.windowed ? `in the ${span}` : "since the server started"}${l.errorPct != null ? ` · ${formatPct(l.errorPct)} errors` : ""}`
        : l.measured
          ? `${sourceName} → ${hub.name} · measured, no calls in the ${span}`
          : `${sourceName} → ${hub.name} · referenced by the workflow${hub.kind === "connector" ? "; never counted by the exporter" : ""}`
      const data: DependencyEdgeData = { title }
      return {
        id: e.id,
        source: e.source,
        target: e.target,
        type: "dependency",
        data,
        style: {
          stroke,
          strokeWidth: busy ? sqrtScale(l.calls, maxCalls, 1.5, 8) : 1,
          strokeDasharray: l.measured ? undefined : "4 4",
          opacity: inFocus ? (busy ? 0.85 : 0.7) : 0.1,
        },
      }
    })
  }, [depEdges, dg, connectorTraffic.byEdge, hasWindow, traffic.spanLabel, colorMetric, lit])

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
