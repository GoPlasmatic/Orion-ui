import { flattenSteps, workflowSteps } from "@/lib/workflow-steps"
import { buildDomains, type DomainIndex, type DomainMode } from "@/lib/domains"
import type { EntityIndex } from "@/lib/topology"
import type { SystemGraph } from "@/lib/system-graph"
import type { ChannelTraffic } from "@/hooks/use-metrics"
import type { ConnectorChannelTraffic, ConnectorTraffic } from "@/hooks/use-ops-metrics"
import { errorLevel, latencyLevel, type ColorMetric, type HealthLevel } from "@/lib/traffic-encoding"

/**
 * The System Map's **dependencies lens**: domains on the left, the shared
 * things they lean on — connectors, plugins, models — as hubs on the right.
 *
 * The calls lens draws `channel_call` edges, which is the right picture for a
 * fan-out design and an empty one for a system whose channels coordinate
 * through shared state. QA runs 148 channels with no call between any two of
 * them; the structure that matters there is that 145 of them write to one
 * database. `system-graph.ts` left connectors out as nodes on purpose — one
 * used by every workflow adds an edge everywhere and distinguishes nothing —
 * and that stays true per channel. The fix is to group the channels into
 * domains first, so one edge says "admin depends on soma-db", and to let a
 * hub be selected: its dependants are the outage blast radius.
 *
 * Edge weight is measured where it can be: `orion_connector_requests_total`
 * carries both `channel` and `connector`, so a channel → connector edge is a
 * count, not an inference. Static references (`workflowConnectorRefs`) are the
 * fallback, drawn thin and dashed when nothing was measured.
 *
 * Pure and synchronous. Ids: a channel is its **name** (the join key for
 * metrics), a domain is `domain:<name>`, a hub `connector:<name>`,
 * `plugin:<id>` or `model:<id>` — so one `?select=` can name any of them.
 */

export type HubKind = "connector" | "plugin" | "model"
const HUB_KINDS: HubKind[] = ["connector", "plugin", "model"]

export const hubId = (kind: HubKind, name: string) => `${kind}:${name}`
export const domainId = (name: string) => `domain:${name}`

/** A `?select=` value that names a hub, split; null for a channel name. */
export function parseHubId(id: string | null | undefined): { kind: HubKind; name: string } | null {
  if (!id) return null
  const colon = id.indexOf(":")
  if (colon <= 0) return null
  const kind = id.slice(0, colon) as HubKind
  if (!HUB_KINDS.includes(kind)) return null
  return { kind, name: id.slice(colon + 1) }
}

export interface Hub {
  id: string
  kind: HubKind
  name: string
  /** `connector_type` for a connector; the kind otherwise. Null when not registered. */
  type: string | null
  enabled: boolean
  /** Resolves to a registered entity. A reference to nothing is drawn dashed. */
  known: boolean
  /** Routing id: the connector UUID, the plugin or model id. */
  refId: string
  /** Channels in view that depend on it, by name, sorted. */
  dependants: string[]
}

export interface DomainGroup {
  id: string
  name: string
  /** Channel names in view, sorted. */
  members: string[]
}

export interface DependencyGraph {
  domainIndex: DomainIndex
  domains: DomainGroup[]
  hubs: Hub[]
  hubById: Map<string, Hub>
  /** Channel name → hub ids it depends on, sorted. */
  refsOf: Map<string, string[]>
  /** Channel name → its domain id. */
  domainOf: Map<string, string>
}

export interface DependencyOptions {
  /** Channel names the view keeps (lifecycle, tag); everything registered when absent. */
  visible?: ReadonlySet<string>
  mode?: DomainMode
  /** Function name → plugin id, from the catalogue's `source: "plugin"` rows. */
  pluginOfFunction?: ReadonlyMap<string, string>
  /**
   * `[channel, connector]` pairs the exporter has counted. Folded into the
   * references so a connector a workflow names at runtime still has its edge.
   */
  measured?: Iterable<readonly [string, string]>
  /** Show registered connectors nothing references, as idle hubs. Default true. */
  includeUnused?: boolean
}

/** `model_infer`'s literal `model`; a computed one is answered per message and is unknowable here. */
function modelRefs(tasks: ReturnType<typeof flattenSteps>): string[] {
  const out = new Set<string>()
  for (const t of tasks) {
    if (t.function?.name !== "model_infer") continue
    const model = (t.function.input as Record<string, unknown> | undefined)?.model
    if (typeof model === "string" && model) out.add(model)
  }
  return [...out]
}

export function buildDependencyGraph(
  graph: SystemGraph,
  index: EntityIndex,
  options: DependencyOptions = {},
): DependencyGraph {
  const { visible, mode = { by: "prefix" }, pluginOfFunction, measured, includeUnused = true } = options
  const channels = graph.nodes.filter((n) => !n.unresolved && (!visible || visible.has(n.id)))
  const inView = new Set(channels.map((n) => n.id))

  const domainIndex = buildDomains(channels, mode)
  const domains: DomainGroup[] = [...domainIndex.members.entries()].map(([name, members]) => ({
    id: domainId(name),
    name,
    members,
  }))
  const domainOf = new Map<string, string>()
  for (const [channel, name] of domainIndex.domainOf) domainOf.set(channel, domainId(name))

  const hubs = new Map<string, Hub>()
  const refs = new Map<string, Set<string>>()
  const note = (channel: string, kind: HubKind, name: string) => {
    const id = hubId(kind, name)
    if (!hubs.has(id)) hubs.set(id, makeHub(kind, name, index))
    const set = refs.get(channel) ?? new Set<string>()
    set.add(id)
    refs.set(channel, set)
  }

  for (const node of channels) {
    for (const c of node.connectors) note(node.id, "connector", c)
    const workflow = node.workflowId ? index.workflowsById.get(node.workflowId) : undefined
    if (!workflow) continue
    const tasks = flattenSteps(workflowSteps(workflow))
    for (const m of modelRefs(tasks)) note(node.id, "model", m)
    if (pluginOfFunction && pluginOfFunction.size > 0) {
      for (const t of tasks) {
        const plugin = t.function ? pluginOfFunction.get(t.function.name) : undefined
        if (plugin) note(node.id, "plugin", plugin)
      }
    }
  }
  for (const [channel, connector] of measured ?? []) {
    if (inView.has(channel) && connector) note(channel, "connector", connector)
  }
  if (includeUnused) {
    for (const c of index.connectorsByName.values()) {
      const id = hubId("connector", c.name)
      if (!hubs.has(id)) hubs.set(id, makeHub("connector", c.name, index))
    }
  }

  const refsOf = new Map<string, string[]>()
  for (const [channel, set] of refs) {
    const list = [...set].sort()
    refsOf.set(channel, list)
    for (const id of list) hubs.get(id)!.dependants.push(channel)
  }
  for (const hub of hubs.values()) hub.dependants.sort()

  // Busiest first, so the hub everything leans on heads the column before
  // the layout's barycenter pass moves it among its dependants.
  const sorted = [...hubs.values()].sort(
    (a, b) =>
      b.dependants.length - a.dependants.length ||
      HUB_KINDS.indexOf(a.kind) - HUB_KINDS.indexOf(b.kind) ||
      a.name.localeCompare(b.name),
  )
  return {
    domainIndex,
    domains,
    hubs: sorted,
    hubById: new Map(sorted.map((h) => [h.id, h])),
    refsOf,
    domainOf,
  }
}

function makeHub(kind: HubKind, name: string, index: EntityIndex): Hub {
  if (kind === "connector") {
    const registered = index.connectorsByName.get(name)
    return {
      id: hubId(kind, name),
      kind,
      name,
      type: registered?.connector_type ?? null,
      enabled: registered?.enabled ?? false,
      known: !!registered,
      refId: registered?.id ?? name,
      dependants: [],
    }
  }
  // Plugins and models are not in the entity index; a reference is taken at
  // its word, and the detail page is where "does it exist" is answered.
  return { id: hubId(kind, name), kind, name, type: kind, enabled: true, known: true, refId: name, dependants: [] }
}

// ---------------------------------------------------------------------------
// Edges
// ---------------------------------------------------------------------------

export interface DepEdge {
  id: string
  /** A domain id when the domain is collapsed, a channel name when it is open. */
  source: string
  /** A hub id. */
  target: string
  /** The channels the edge stands for — one, or every member referencing the hub. */
  channels: string[]
}

/**
 * One edge per (domain, hub) for a collapsed domain — the members' references
 * aggregated — and one per (channel, hub) inside an open one.
 */
export function dependencyEdges(dg: DependencyGraph, isExpanded: (domainId: string) => boolean): DepEdge[] {
  const out: DepEdge[] = []
  for (const domain of dg.domains) {
    if (isExpanded(domain.id)) {
      for (const channel of domain.members) {
        for (const hub of dg.refsOf.get(channel) ?? []) {
          out.push({ id: `${channel}=>${hub}`, source: channel, target: hub, channels: [channel] })
        }
      }
      continue
    }
    const byHub = new Map<string, string[]>()
    for (const channel of domain.members) {
      for (const hub of dg.refsOf.get(channel) ?? []) byHub.set(hub, [...(byHub.get(hub) ?? []), channel])
    }
    for (const [hub, channels] of byHub) {
      out.push({ id: `${domain.id}=>${hub}`, source: domain.id, target: hub, channels })
    }
  }
  return out
}

/**
 * `useConnectorTraffic().byEdge`'s key. Spelled out here rather than imported
 * so this module stays free of the hook module at runtime (a test mocking
 * `use-ops-metrics` must not take the map's pure half down with it); the test
 * asserts the two agree.
 */
export const connectorEdgeKey = (channel: string, connector: string) => `${channel}|${connector}`

export interface EdgeLoad {
  /** Calls in the window, or since the server started while only one sample exists. */
  calls: number
  errors: number
  /** errors / calls; null with no calls. */
  errorPct: number | null
  /** The exporter counted something on this edge. Otherwise it is a static reference. */
  measured: boolean
  /** True when `calls` is a window count rather than a cumulative one. */
  windowed: boolean
}

/**
 * What crossed an edge, summed over the channels it stands for. Only a
 * connector is metered per channel; a plugin or model edge is always a
 * reference.
 */
export function edgeLoad(
  channels: string[],
  hub: Pick<Hub, "kind" | "name">,
  byEdge: ReadonlyMap<string, ConnectorChannelTraffic>,
): EdgeLoad {
  let calls = 0
  let errors = 0
  let windowed = true
  if (hub.kind === "connector") {
    for (const channel of channels) {
      const e = byEdge.get(connectorEdgeKey(channel, hub.name))
      if (!e) continue
      if (e.windowed == null) {
        windowed = false
        calls += e.total
      } else {
        calls += e.windowed
        errors += e.errors ?? 0
      }
    }
  }
  return {
    calls,
    errors,
    errorPct: calls > 0 && windowed ? (errors / calls) * 100 : null,
    measured: calls > 0,
    windowed,
  }
}

// ---------------------------------------------------------------------------
// Aggregates and focus
// ---------------------------------------------------------------------------

export interface DomainLoad {
  /** Summed requests per minute; null before a rate exists. */
  rate: number | null
  windowed: number
  ok: number
  failed: number
  /** failed / (ok + failed) across the members. */
  errorPct: number | null
  /** The slowest member's p95. Percentiles do not add, so this is a bound, not the domain's p95. */
  worstP95Ms: number | null
  /** Members that carried anything in the window. */
  active: number
}

export function domainLoad(members: string[], byChannel: ReadonlyMap<string, ChannelTraffic>): DomainLoad {
  let rate: number | null = null
  let windowed = 0
  let ok = 0
  let failed = 0
  let worst: number | null = null
  let active = 0
  for (const m of members) {
    const t = byChannel.get(m)
    if (!t) continue
    if (t.ratePerMin != null) rate = (rate ?? 0) + t.ratePerMin
    windowed += t.windowed
    ok += t.ok
    failed += t.failed
    if (t.windowed > 0) active++
    if (t.p95Ms != null && t.windowed > 0) worst = Math.max(worst ?? 0, t.p95Ms)
  }
  return {
    rate,
    windowed,
    ok,
    failed,
    errorPct: ok + failed > 0 ? (failed / (ok + failed)) * 100 : null,
    worstP95Ms: worst,
    active,
  }
}

/**
 * The blast radius of a selection, as ids to keep lit. A hub lights every
 * dependant and the domains holding them — what an outage of it takes down.
 * A channel lights itself, its domain and what it depends on.
 */
export function dependencyFocus(dg: DependencyGraph, selected: string): Set<string> {
  const out = new Set<string>([selected])
  const hub = dg.hubById.get(selected)
  if (hub) {
    for (const channel of hub.dependants) {
      out.add(channel)
      const d = dg.domainOf.get(channel)
      if (d) out.add(d)
    }
    return out
  }
  const d = dg.domainOf.get(selected)
  if (d) out.add(d)
  for (const h of dg.refsOf.get(selected) ?? []) out.add(h)
  return out
}

/** A hub's dependants grouped by domain, biggest group first — the inspector's list. */
export function dependantsByDomain(dg: DependencyGraph, hub: Hub): { domain: string; channels: string[] }[] {
  const groups = new Map<string, string[]>()
  for (const channel of hub.dependants) {
    const name = dg.domainIndex.domainOf.get(channel) ?? "other"
    groups.set(name, [...(groups.get(name) ?? []), channel])
  }
  return [...groups.entries()]
    .map(([domain, channels]) => ({ domain, channels }))
    .sort((a, b) => b.channels.length - a.channels.length || a.domain.localeCompare(b.domain))
}

/**
 * A hub's colour slot under the map's colour metric. Health is the error share
 * of its calls; a connector the engine could not load is critical whatever its
 * counters say, because nothing reaches it to fail. Lifecycle reads
 * registered-and-enabled, the closest a connector has to a status.
 */
export function hubLevel(
  metric: ColorMetric,
  hub: Pick<Hub, "known" | "enabled">,
  traffic: Pick<ConnectorTraffic, "windowed" | "total" | "errorPct" | "p95Ms"> | undefined,
  failedToLoad = false,
): HealthLevel {
  if (metric === "lifecycle") return !hub.known || failedToLoad ? "critical" : hub.enabled ? "healthy" : "idle"
  if (failedToLoad && metric === "health") return "critical"
  const calls = traffic ? (traffic.windowed ?? traffic.total) : 0
  if (calls === 0) return "idle"
  if (metric === "latency") return latencyLevel(traffic?.p95Ms)
  return errorLevel(traffic?.errorPct)
}

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

export interface Size {
  width: number
  height: number
}

export interface DepLayoutSizes {
  /** A collapsed domain's summary box. */
  domain: Size
  channel: Size
  hub: Size
}

export interface DomainPlacement {
  id: string
  x: number
  y: number
  width: number
  height: number
  expanded: boolean
}

export interface DepLayout {
  domains: DomainPlacement[]
  /** Channels inside open domains, and hubs. */
  positions: Map<string, { x: number; y: number }>
  width: number
  height: number
}

const COLUMN_GAP = 300
const ROW_GAP = 14
const HUB_GAP = 12
const FRAME_PAD = 12
const CELL_GAP_X = 10
const CELL_GAP_Y = 8
/** Height of an open domain's caption, above its grid. */
export const DOMAIN_HEADER = 34
/** Rows an open domain fills before it grows another column. */
const ROWS_PER_COL = 10
const MAX_COLS = 4

const mean = (v: number[]) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : null)

/**
 * Two columns: domains stacked on the left (right-aligned, so a summary box and
 * an open frame both end where the edges start), hubs on the right, each at the
 * mean height of whatever depends on it and pushed down only as far as needed
 * to clear the hub above. Inside an open domain, channels sharing one set of
 * hubs sit together so their edges leave as a bundle.
 */
export function layoutDependencies(
  dg: DependencyGraph,
  isExpanded: (domainId: string) => boolean,
  sizes: DepLayoutSizes,
): DepLayout {
  const positions = new Map<string, { x: number; y: number }>()
  const boxes: DomainPlacement[] = []
  const centres = new Map<string, number>()

  // Measure the left column first; x is fixed once its width is known.
  const items = dg.domains.map((domain) => {
    const expanded = isExpanded(domain.id) && domain.members.length > 0
    if (!expanded) return { domain, expanded, ...sizes.domain, cols: 1, order: [] as string[] }
    const order = [...domain.members].sort((a, b) => {
      const ka = (dg.refsOf.get(a) ?? []).join(" ")
      const kb = (dg.refsOf.get(b) ?? []).join(" ")
      return ka.localeCompare(kb) || a.localeCompare(b)
    })
    const cols = Math.min(MAX_COLS, Math.max(1, Math.ceil(order.length / ROWS_PER_COL)))
    const rows = Math.ceil(order.length / cols)
    return {
      domain,
      expanded,
      cols,
      order,
      width: Math.max(sizes.domain.width, cols * sizes.channel.width + (cols - 1) * CELL_GAP_X + FRAME_PAD * 2),
      height: DOMAIN_HEADER + rows * sizes.channel.height + (rows - 1) * CELL_GAP_Y + FRAME_PAD,
    }
  })
  const leftWidth = Math.max(0, ...items.map((i) => i.width))

  let y = 0
  for (const item of items) {
    const x = leftWidth - item.width
    boxes.push({ id: item.domain.id, x, y, width: item.width, height: item.height, expanded: item.expanded })
    centres.set(item.domain.id, y + item.height / 2)
    item.order.forEach((channel, i) => {
      const row = Math.floor(i / item.cols)
      const col = i % item.cols
      const cx = x + FRAME_PAD + col * (sizes.channel.width + CELL_GAP_X)
      const cy = y + DOMAIN_HEADER + row * (sizes.channel.height + CELL_GAP_Y)
      positions.set(channel, { x: cx, y: cy })
      centres.set(channel, cy + sizes.channel.height / 2)
    })
    y += item.height + ROW_GAP
  }
  const leftHeight = Math.max(0, y - ROW_GAP)

  // Hubs at the barycenter of their sources. A source is the open channel, or
  // the domain box standing in for it; hubs nothing in view uses go last.
  const sourceCentre = (channel: string) =>
    centres.get(channel) ?? centres.get(dg.domainOf.get(channel) ?? "") ?? null
  const keyed = dg.hubs.map((hub, index) => {
    const ys = hub.dependants.map(sourceCentre).filter((v): v is number => v != null)
    return { hub, index, key: mean(ys) }
  })
  keyed.sort((a, b) => {
    if (a.key == null || b.key == null) return a.key == null ? (b.key == null ? a.index - b.index : 1) : -1
    return a.key - b.key || a.index - b.index
  })
  const hubX = leftWidth + COLUMN_GAP
  let bottom = -Infinity
  for (const { hub, key } of keyed) {
    const wanted = (key ?? bottom + HUB_GAP + sizes.hub.height / 2) - sizes.hub.height / 2
    const hy = Math.max(wanted, bottom + HUB_GAP, 0)
    positions.set(hub.id, { x: hubX, y: hy })
    bottom = hy + sizes.hub.height
  }

  return {
    domains: boxes,
    positions,
    width: dg.hubs.length ? hubX + sizes.hub.width : leftWidth,
    height: Math.max(leftHeight, bottom === -Infinity ? 0 : bottom),
  }
}

/**
 * Which lens a map opens on when the URL does not say: calls when
 * `channel_call` structure is a meaningful share of the system — at least a
 * tenth of the channels make or receive a call — dependencies otherwise.
 */
export const CALLS_SHARE = 0.1

export function callShare(graph: SystemGraph): number {
  const registered = graph.nodes.filter((n) => !n.unresolved)
  if (registered.length === 0) return 0
  const involved = registered.filter((n) => n.callers.length > 0 || n.callees.length > 0).length
  return involved / registered.length
}
