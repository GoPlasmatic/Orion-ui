import { useCallback, useMemo, useState } from "react"
import { Link } from "react-router"
import { useEntityIndex } from "@/hooks/use-entity-index"
import {
  DEFAULT_TRAFFIC_WINDOW,
  TRAFFIC_WINDOWS,
  trafficWindowFromParam,
  trafficWindowLabel,
  useChannelTraffic,
} from "@/hooks/use-metrics"
import { useMapTelemetry } from "@/hooks/use-faults"
import { useConnectorTraffic } from "@/hooks/use-ops-metrics"
import { useFunctionIndex } from "@/hooks/use-functions"
import {
  CALLS_SHARE,
  buildDependencyGraph,
  callShare,
  mapSearch,
  parseHubId,
} from "@/lib/dependency-graph"
import type { DomainMode } from "@/lib/domains"
import { faultsFor } from "@/lib/faults"
import { useUrlFilters } from "@/lib/use-url-filters"
import { useMediaQuery } from "@/lib/media-query"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Callout } from "@/components/ui/callout"
import { Dialog, DialogBody, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { PageHeader } from "@/components/shared/page-header"
import { FilterBar } from "@/components/shared/filter-bar"
import { EmptyState } from "@/components/shared/empty-state"
import { TrafficMap } from "@/components/graph/traffic-map"
import { DependencyMap } from "@/components/graph/dependency-map"
import { HealthGrid } from "@/components/graph/health-grid"
import { HubInspector } from "@/components/graph/hub-inspector"
import { useChangePins } from "@/hooks/use-change-pins"
import { InspectorPlaceholder, MapInspector } from "@/components/graph/map-inspector"
import { HUB_THRESHOLD } from "@/components/graph/traffic-node"
import {
  COLOR_METRICS,
  SIZE_METRICS,
  deriveLoad,
  formatPct,
  healthDot,
  legendFor,
  type ColorMetric,
  type HealthLevel,
  type SizeMetric,
} from "@/lib/traffic-encoding"
import { cn } from "@/lib/utils"
import {
  AlertTriangle,
  HelpCircle,
  LayoutGrid,
  Network,
  Share2,
  Waypoints,
  Pause,
  Play,
  Plug,
  Search,
  ShieldAlert,
  Unplug,
} from "lucide-react"

/**
 * The System Map, as a live traffic view of the channel call graph.
 *
 * It used to be a channel picker in front of `buildChannelTopology` — the same
 * builder the detail pages embed — so it rendered one rooted 3-to-5 node diagram
 * at a time and duplicated what `/channels/:id` already showed. Worse, it walked
 * forward only, so the thing most worth knowing about a system like this (which
 * channels everything else depends on) was structurally unreachable.
 *
 * This version builds the graph once and treats live telemetry as the primary
 * encoding: dot area is throughput, colour is health, edge weight is the
 * caller's rate. What is busy and what is broken should be legible before you
 * read a single label.
 *
 * Every view setting lives in the URL — `select`, `q`, `tag`, `lifecycle`,
 * `window`, `size`, `colour`, `hops`, `lens`, `group` — so a dashboard alert
 * can land on the failing channel, and a link pasted into an incident thread
 * opens the same view. `select` names a channel, or on the dependencies lens
 * a hub (`connector:soma-db`).
 */

type LifecycleFilter = "active" | "all"

/**
 * Three lenses on one system. `deps` draws domains against the connectors,
 * plugins and models they share; `calls` the tiered `channel_call` graph;
 * `grid` every channel as a tile. With no `?lens=` the map picks calls only
 * when calls are a meaningful share of the system.
 */
type Lens = "deps" | "calls" | "grid"
const LENSES: { value: Lens; label: string; icon: typeof Network }[] = [
  { value: "deps", label: "Dependencies", icon: Share2 },
  { value: "calls", label: "Calls", icon: Waypoints },
  { value: "grid", label: "Health grid", icon: LayoutGrid },
]
const isLens = (v: string): v is Lens => LENSES.some((l) => l.value === v)

/**
 * `?group=` — `prefix` (the default, empty in the URL) or `tag:<a,b>`: a
 * channel's domain is the first of those tags it carries.
 */
function domainModeFromParam(raw: string): DomainMode {
  if (raw.startsWith("tag:")) {
    const tags = raw.slice(4).split(",").map((t) => t.trim()).filter(Boolean)
    if (tags.length > 0) return { by: "tag", tags }
  }
  return { by: "prefix" }
}

/** Every view setting, in the URL. */
const VIEW_KEYS = ["select", "q", "tag", "lifecycle", "window", "size", "colour", "hops", "lens", "group"] as const

function LegendSwatch({ level, label }: { level: HealthLevel; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={cn("h-2 w-2 shrink-0 rounded-full", healthDot[level])} />
      <span className="text-muted-foreground">{label}</span>
    </span>
  )
}

/**
 * The encodings, written down. The map says a lot through shape — dot area,
 * a hollow ring, a thick ring, a dashed border, a card that is small — and
 * none of it was explained anywhere a person could read it.
 */
function MapHelpDialog({ colorMetric, onClose }: { colorMetric: ColorMetric; onClose: () => void }) {
  const colorName = COLOR_METRICS.find((m) => m.value === colorMetric)?.label ?? "Health"
  return (
    <Dialog open onClose={onClose} aria-label="How to read the System Map">
      <DialogHeader>
        <DialogTitle>How to read this map</DialogTitle>
      </DialogHeader>
      <DialogBody className="text-sm">
        <section className="space-y-1">
          <p className="font-medium">Three lenses</p>
          <ul className="space-y-1 text-muted-foreground">
            <li>
              <span className="font-medium text-foreground">Dependencies:</span> domains (the name
              segment after the shared prefix, or the tags you group by) on the left, the
              connectors, plugins and models they use on the right. Edge width is measured calls
              from <code className="font-mono">orion_connector_requests_total</code>; a thin dashed
              edge is a reference in the workflow with nothing measured. Click a connector to light
              up everything that depends on it.
            </li>
            <li>
              <span className="font-medium text-foreground">Calls:</span> the{" "}
              <code className="font-mono">channel_call</code> graph, described below.
            </li>
            <li>
              <span className="font-medium text-foreground">Health grid:</span> every channel as a
              tile under its domain — wider is busier, colour is the colour metric.
            </li>
          </ul>
          <p className="text-muted-foreground">
            A <span className="font-medium text-info">pin</span> marks a channel or its workflow
            changed in the last day; hover it for what changed.
          </p>
        </section>
        <section className="space-y-1">
          <p className="font-medium">Lanes and clusters (calls)</p>
          <p className="text-muted-foreground">
            Entry channels — reached over their route, or started by a schedule — sit in the left
            lane. Each lane to the right is one more <code className="font-mono">channel_call</code>{" "}
            hop from an entry, so a hub sits downstream of everything that reaches it. Entries that
            call the same set of channels are boxed together as a cluster with one arrow per callee.
          </p>
        </section>
        <section className="space-y-1">
          <p className="font-medium">Colour · {colorName}</p>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
            {legendFor(colorMetric).map((entry) => (
              <LegendSwatch key={entry.level} level={entry.level} label={entry.label} />
            ))}
          </div>
        </section>
        <section className="space-y-1">
          <p className="font-medium">Size</p>
          <p className="text-muted-foreground">
            The dot's <em>area</em> is the selected size metric, scaled by square root against the
            busiest channel on the canvas — ten times the traffic is a little over three times the
            diameter, so one hub does not swallow the map.
          </p>
        </section>
        <section className="space-y-1">
          <p className="font-medium">Shapes</p>
          <ul className="space-y-1 text-muted-foreground">
            <li>
              <span className="font-medium text-foreground">Hollow dot, </span>
              <span className="font-mono">≤ n/m</span>: nothing reaches this channel from outside,
              so the exporter carries no series for it. The rate is inherited from its callers and
              is an upper bound.
            </li>
            <li>
              <span className="font-medium text-foreground">Thick ring:</span> a hub — called by{" "}
              {HUB_THRESHOLD} or more channels.
            </li>
            <li>
              <span className="font-medium text-foreground">Dashed border:</span> named by a{" "}
              <code className="font-mono">channel_call</code> but not registered. The call fails at
              runtime.
            </li>
            <li>
              <span className="font-medium text-foreground">Small card:</span> no traffic in the
              window. Present for context, drawn quiet.
            </li>
            <li>
              <span className="font-medium text-foreground">Edge width:</span> the caller's own
              rate. Nothing attributes an arrival to a particular caller, so it is a bound, not a
              measurement.
            </li>
            <li>
              <span className="font-medium text-foreground">Dimming:</span> selecting a channel dims
              everything outside its blast radius — one call away by default; the inspector widens
              it to two hops or everything reachable.
            </li>
            <li>
              <span className="font-medium text-foreground">Zoomed out:</span> cards become a dot
              and a large name, so a channel can be found at overview scale. Zoom in for the
              figures.
            </li>
            <li>
              <span className="font-medium text-foreground">Clusters:</span> on a big map a crowd of
              entries with the same callees folds into one summary box — count, combined rate,
              worst health. Click the box to open it, click its frame to fold it again.
            </li>
          </ul>
        </section>
      </DialogBody>
      <DialogFooter>
        <Button onClick={onClose}>Close</Button>
      </DialogFooter>
    </Dialog>
  )
}

const isSizeMetric = (v: string): v is SizeMetric => SIZE_METRICS.some((m) => m.value === v)
const isColorMetric = (v: string): v is ColorMetric => COLOR_METRICS.some((m) => m.value === v)

export function SystemMapPage() {
  const { graph, index, isLoading } = useEntityIndex()

  // View state is the URL, replaced rather than pushed on every change so
  // typing a search does not fill the history with one entry per keystroke.
  const { values: view, set: setView } = useUrlFilters(VIEW_KEYS)
  const windowSec = trafficWindowFromParam(view.window)
  const lifecycle: LifecycleFilter = view.lifecycle === "all" ? "all" : "active"
  const sizeMetric: SizeMetric = isSizeMetric(view.size) ? view.size : "rate"
  const colorMetric: ColorMetric = isColorMetric(view.colour) ? view.colour : "health"
  const search = view.q
  const tag = view.tag
  const selectedId = view.select || null
  // Blast radius: how far the focus reaches from the selection. One hop by
  // default — in a connected system "everything reachable" dims nothing.
  const hops = view.hops === "all" ? Infinity : view.hops === "2" ? 2 : 1
  const domainMode = useMemo(() => domainModeFromParam(view.group), [view.group])

  // The lens picks itself from the graph unless the URL names one: calls only
  // when a meaningful share of channels make or receive a channel_call.
  const share = useMemo(() => callShare(graph), [graph])
  const autoLens: Lens = share >= CALLS_SHARE ? "calls" : "deps"
  const lensIsAuto = !isLens(view.lens)
  const lens: Lens = isLens(view.lens) ? view.lens : autoLens

  const [paused, setPaused] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  // Selections made from a list rather than the canvas ask the canvas to
  // travel. A selection that arrived in the URL counts: the page opened on it.
  const [revealToken, setRevealToken] = useState(() => (view.select ? 1 : 0))
  // One inspector, in the column above `lg` and as a sheet below it — not
  // two mounted with one hidden.
  const wide = useMediaQuery("(min-width: 1024px)")

  const setSelectedId = useCallback((id: string | null) => setView({ select: id ?? "" }), [setView])
  function reveal(id: string, patch: Record<string, string> = {}) {
    setView({ select: id, ...patch })
    setRevealToken((t) => t + 1)
  }
  const revealChannel = (id: string) => reveal(id)
  // A hub only exists on the dependencies lens; asking for one elsewhere goes there.
  const revealHub = (id: string) => reveal(id, lens === "deps" ? {} : { lens: "deps" })

  const traffic = useChannelTraffic(windowSec, paused)
  const connectorTraffic = useConnectorTraffic(windowSec, paused)
  // Quarantines, failed connectors and open breakers, and a cron channel's
  // next fire: what the counters cannot show, drawn on the nodes they touch.
  const { faults, nextFire } = useMapTelemetry(graph)
  const pins = useChangePins(graph)
  const functions = useFunctionIndex()

  const connectorsByName = useMemo(
    () => new Map(graph.connectors.map((c) => [c.name, c])),
    [graph.connectors],
  )
  // The inspector needs the same measured-or-inferred load the canvas draws.
  const load = useMemo(() => deriveLoad(graph, traffic.byChannel), [graph, traffic.byChannel])

  /**
   * What the canvas draws: every live channel, by default. Traffic is a
   * highlight, not a filter — hiding the idle channels used to make the map
   * collapse to whichever three routes had been hit, with no sense of where
   * they sat in the system.
   *
   * Whatever the filters keep, its direct call neighbours come along as
   * context — an edge with one end missing tells you nothing — so filtering
   * never severs a call from the thing on the other side of it.
   */
  const visible = useMemo(() => {
    let seeds = graph.nodes

    if (lifecycle === "active") seeds = seeds.filter((n) => n.status === "active")
    if (tag) seeds = seeds.filter((n) => n.tags.includes(tag))

    const ids = new Set(seeds.map((n) => n.id))
    for (const node of seeds) {
      for (const other of [...node.callers, ...node.callees]) ids.add(other)
    }
    return ids
  }, [graph.nodes, lifecycle, tag])

  /**
   * Channel → connector pairs the exporter has counted, as a stable key: the
   * set changes when a new pair first appears, not on every poll, so the
   * dependency graph rebuilds on structure and never on a count.
   */
  const measuredKey = useMemo(
    () => [...connectorTraffic.byEdge.keys()].sort().join("\n"),
    [connectorTraffic.byEdge],
  )
  const dg = useMemo(() => {
    const measured = measuredKey
      ? measuredKey.split("\n").map((k) => {
          const bar = k.indexOf("|")
          return [k.slice(0, bar), k.slice(bar + 1)] as const
        })
      : []
    return buildDependencyGraph(graph, index, { visible, mode: domainMode, functions, measured })
  }, [graph, index, visible, domainMode, functions, measuredKey])

  const viewNodes = useMemo(
    () => graph.nodes.filter((n) => visible.has(n.id) && !n.unresolved),
    [graph.nodes, visible],
  )

  /**
   * Search highlights rather than filters: the hits stay lit and everything
   * else dims, so the canvas holds still while a name is typed instead of
   * re-laying out on every keystroke. Null when nothing is typed. On the
   * dependencies lens a connector, plugin or model name is a hit too, and a
   * domain named with its prefix (`?q=soma-clock`, the Operations domain
   * cards' link) lights exactly that domain.
   */
  const visibleNodes = useMemo(() => graph.nodes.filter((n) => visible.has(n.id)), [graph.nodes, visible])
  const matches = useMemo(
    () => mapSearch(search, visibleNodes, dg.domainIndex, lens === "deps" ? dg.hubs : []),
    [search, visibleNodes, dg.domainIndex, dg.hubs, lens],
  )

  const selected = selectedId ? (graph.byId.get(selectedId) ?? null) : null
  const selectedHub =
    lens === "deps" && parseHubId(selectedId) ? (dg.hubById.get(selectedId ?? "") ?? null) : null

  // Channels the window says are actually broken, as opposed to merely refusing
  // unauthenticated callers.
  const failing = useMemo(
    () =>
      traffic.channels
        .filter((c) => c.failed > 0 && c.errorPct != null && c.errorPct >= 1)
        .sort((a, b) => (b.errorPct ?? 0) - (a.errorPct ?? 0)),
    [traffic.channels],
  )

  const spanLabel = traffic.spanLabel
  const windowLabel = trafficWindowLabel(windowSec)
  const quarantinedNames = [...faults.quarantined.keys()].filter((name) => graph.byId.has(name))
  const failedConnectors = graph.connectors.filter((c) => faults.failedConnectors.has(c.name))
  const legend = legendFor(colorMetric)
  // Tags carried by most channels group nothing; "group by tag" uses the rest.
  const groupingTags = useMemo(
    () => graph.tags.filter((t) => t.count < graph.nodes.length * 0.9).map((t) => t.tag),
    [graph.tags, graph.nodes.length],
  )
  const tagGroupValue = groupingTags.length > 0 ? `tag:${groupingTags.join(",")}` : ""

  if (isLoading) {
    return (
      <div className="flex h-full flex-col gap-4">
        <PageHeader title="System Map" description="How the system connects, with live traffic" />
        <Skeleton className="min-h-0 flex-1" />
      </div>
    )
  }

  if (graph.nodes.length === 0) {
    return (
      <div className="flex h-full flex-col gap-4">
        <PageHeader title="System Map" description="How the system connects, with live traffic" />
        <EmptyState
          icon={Network}
          title="Nothing to map yet"
          description="Create a channel and the map will show it, what it depends on, and what it is carrying."
        />
      </div>
    )
  }

  const inspector = selectedHub ? (
    <HubInspector
      key={selectedHub.id}
      hub={selectedHub}
      dg={dg}
      connectorTraffic={connectorTraffic}
      spanLabel={spanLabel}
      failedToLoad={selectedHub.kind === "connector" ? (faults.failedConnectors.get(selectedHub.name) ?? null) : null}
      onSelectChannel={revealChannel}
      onClose={() => setSelectedId(null)}
    />
  ) : selected ? (
    <MapInspector
      node={selected}
      traffic={traffic.byChannel.get(selected.id)}
      series={traffic.seriesFor(selected.id)}
      load={load.get(selected.id)}
      graph={graph}
      connectorsByName={connectorsByName}
      faults={faultsFor(selected, faults)}
      mapFaults={faults}
      spanLabel={spanLabel}
      hops={hops}
      onHopsChange={(next) => setView({ hops: next === 1 ? "" : next === 2 ? "2" : "all" })}
      onSelect={(node) => revealChannel(node.id)}
      onClose={() => setSelectedId(null)}
      showHops={lens === "calls"}
      connectorTraffic={connectorTraffic}
      onSelectHub={revealHub}
      changes={pins.get(selected.id)}
      metricsState={traffic.state}
    />
  ) : null

  const activity =
    traffic.state === "live" ? `${traffic.activeCount} carrying traffic · ${spanLabel}` : spanLabel
  const matchNote = matches
    ? matches.size === 0
      ? `nothing matches "${search.trim()}" · `
      : `${matches.size} match${matches.size === 1 ? "" : "es"} · `
    : ""
  const channelsInView = viewNodes.length
  const footer =
    lens === "deps"
      ? `${channelsInView} channels in ${dg.domains.length} domain${dg.domains.length === 1 ? "" : "s"} · ${dg.hubs.length} shared dependenc${dg.hubs.length === 1 ? "y" : "ies"} · ${matchNote}${activity}`
      : lens === "grid"
        ? `${channelsInView} channels · ${matchNote}${activity}`
        : `${visible.size} of ${graph.nodes.length} channels · ${matchNote}${activity}`
  const autoReason =
    share === 0
      ? "no channel calls another"
      : `${Math.round(share * 100)}% of channels make or receive a call`

  return (
    <div className="flex h-full flex-col gap-3">
      <PageHeader
        title="System Map"
        description={
          lens === "deps"
            ? "Domains and the connectors they share — edge width is measured calls, colour is health; click a connector for its blast radius"
            : lens === "grid"
              ? "Every channel as a tile under its domain — wider is busier, colour is health"
              : "Every live channel, entry points on the left and what they call to the right — dot size is throughput, colour is health"
        }
      >
        <div className="flex items-center gap-2">
          <div className="flex gap-0.5 rounded-md border p-0.5" role="group" aria-label="Lens">
            {LENSES.map((l) => {
              const Icon = l.icon
              const active = lens === l.value
              return (
                <button
                  key={l.value}
                  type="button"
                  onClick={() => setView({ lens: l.value })}
                  aria-pressed={active}
                  title={
                    active && lensIsAuto
                      ? `Picked automatically: ${autoReason}`
                      : l.value === autoLens
                        ? `The automatic choice for this system: ${autoReason}`
                        : undefined
                  }
                  className={cn(
                    "flex items-center gap-1.5 rounded px-2 py-1 text-xs transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/60",
                    active ? "bg-secondary text-secondary-foreground" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <Icon className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">{l.label}</span>
                  {active && lensIsAuto && (
                    <span className="rounded bg-background/70 px-1 text-[9px] font-medium uppercase tracking-wide text-muted-foreground">
                      auto
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setPaused((p) => !p)}
          title={paused ? "Resume the 10 s metrics poll" : "Stop polling; the canvas holds still"}
        >
          {paused ? (
            <Play className="h-3.5 w-3.5" />
          ) : (
            <span className="relative flex h-3.5 w-3.5 items-center justify-center">
              <span className="absolute h-2 w-2 animate-ping rounded-full bg-success/60" />
              <Pause className="relative h-3.5 w-3.5" />
            </span>
          )}
          {paused ? "Resume" : "Pause"}
        </Button>
        <Select
          value={String(windowSec)}
          onChange={(e) =>
            setView({ window: e.target.value === String(DEFAULT_TRAFFIC_WINDOW) ? "" : e.target.value })
          }
          className="w-40"
          aria-label="Traffic window"
          title={
            traffic.hasRate && traffic.spanSec < windowSec - 5
              ? `${windowLabel} requested; only the ${spanLabel} is buffered so far`
              : undefined
          }
        >
          {TRAFFIC_WINDOWS.map((w) => (
            <option key={w.value} value={w.value}>
              {w.label}
              {w.value === windowSec && traffic.hasRate && traffic.spanSec < w.value - 5
                ? ` · ${spanLabel} so far`
                : ""}
            </option>
          ))}
        </Select>
      </PageHeader>

      <FilterBar>
        <div className="relative w-full sm:w-64">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder={lens === "deps" ? "Find a channel, connector, route or tag" : "Find a channel, route, topic or tag"}
            value={search}
            onChange={(e) => setView({ q: e.target.value })}
            onKeyDown={(e) => {
              // Enter selects the best match and travels to it; typing alone
              // lights the matches and dims the rest.
              if (e.key !== "Enter" || !matches) return
              const term = search.trim().toLowerCase()
              const hub = lens === "deps" ? dg.hubs.find((h) => h.name.toLowerCase() === term) : undefined
              if (hub) return revealHub(hub.id)
              const hit =
                graph.nodes.find((n) => matches.has(n.id) && n.name.toLowerCase() === term) ??
                graph.nodes.find((n) => matches.has(n.id)) ??
                (lens === "deps" ? dg.hubs.find((h) => matches.has(h.id)) : undefined)
              if (hit) reveal(hit.id)
            }}
            className="pl-8"
            aria-label="Search the map"
          />
        </div>
        <Select
          value={lifecycle}
          onChange={(e) => setView({ lifecycle: e.target.value === "all" ? "all" : "" })}
          className="w-full sm:w-40"
          aria-label="Lifecycle"
        >
          <option value="active">Live channels</option>
          <option value="all">All lifecycles</option>
        </Select>
        {graph.tags.length > 0 && (
          <Select
            value={tag}
            onChange={(e) => setView({ tag: e.target.value })}
            className="w-full sm:w-36"
            aria-label="Tag"
          >
            <option value="">All tags</option>
            {graph.tags.map((t) => (
              <option key={t.tag} value={t.tag}>
                {t.tag} ({t.count})
              </option>
            ))}
          </Select>
        )}
        {lens !== "calls" && (
          <Select
            value={view.group}
            onChange={(e) => setView({ group: e.target.value })}
            className="w-full sm:w-44"
            aria-label="Group channels by"
            title="How channels are grouped into domains"
          >
            <option value="">Group: name prefix</option>
            {tagGroupValue && <option value={tagGroupValue}>Group: tags</option>}
            {view.group && view.group !== tagGroupValue && (
              <option value={view.group}>Group: {view.group.replace(/^tag:/, "tags ").replace(/,/g, ", ")}</option>
            )}
          </Select>
        )}
        <Select
          value={sizeMetric}
          onChange={(e) => setView({ size: e.target.value === "rate" ? "" : e.target.value })}
          className="w-full sm:w-48"
          aria-label="Size by"
        >
          {SIZE_METRICS.map((m) => (
            <option key={m.value} value={m.value}>
              Size: {m.label}
            </option>
          ))}
        </Select>
        <Select
          value={colorMetric}
          onChange={(e) => {
            const next = e.target.value
            // Colouring by lifecycle with only live channels shown is one
            // colour; widen the filter so the mode has something to say. One
            // patch: two sequential writes would each start from the same
            // params and the second would undo the first.
            setView({
              colour: next === "health" ? "" : next,
              ...(next === "lifecycle" && lifecycle === "active" ? { lifecycle: "all" } : {}),
            })
          }}
          className="w-full sm:w-40"
          aria-label="Colour by"
        >
          {COLOR_METRICS.map((m) => (
            <option key={m.value} value={m.value}>
              Colour: {m.label}
            </option>
          ))}
        </Select>

        <div className="ml-auto flex items-center gap-3 text-xs">
          <div className="hidden flex-wrap items-center gap-3 md:flex">
            {legend.map((entry) => (
              <LegendSwatch key={entry.level} level={entry.level} label={entry.label} />
            ))}
          </div>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => setHelpOpen(true)}
            aria-label="How to read this map"
            title="How to read this map"
            className="text-muted-foreground"
          >
            <HelpCircle />
          </Button>
        </div>
      </FilterBar>

      {(failing.length > 0 || quarantinedNames.length > 0 || failedConnectors.length > 0) && (
        <Callout variant="destructive" className="py-2">
          <div className="space-y-1 text-xs">
            {failing.length > 0 && (
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                <span className="font-medium">
                  {failing.length} channel{failing.length === 1 ? "" : "s"} failing in the {spanLabel}:
                </span>
                {failing.slice(0, 4).map((c) => (
                  <button
                    key={c.channel}
                    type="button"
                    onClick={() => revealChannel(c.channel)}
                    className="rounded font-mono underline underline-offset-2 hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
                  >
                    {c.channel} {formatPct(c.errorPct)}
                  </button>
                ))}
                {failing.length > 4 && <span>+{failing.length - 4} more</span>}
              </div>
            )}
            {quarantinedNames.length > 0 && (
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <ShieldAlert className="h-3.5 w-3.5 shrink-0" />
                <span className="font-medium">
                  {quarantinedNames.length} quarantined — refused at load, route not served:
                </span>
                {quarantinedNames.slice(0, 4).map((name) => (
                  <button
                    key={name}
                    type="button"
                    onClick={() => revealChannel(name)}
                    className="rounded font-mono underline underline-offset-2 hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
                    title={faults.quarantined.get(name) || undefined}
                  >
                    {name}
                  </button>
                ))}
                {quarantinedNames.length > 4 && <span>+{quarantinedNames.length - 4} more</span>}
              </div>
            )}
            {failedConnectors.length > 0 && (
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <Unplug className="h-3.5 w-3.5 shrink-0" />
                <span className="font-medium">
                  {failedConnectors.length} connector{failedConnectors.length === 1 ? "" : "s"} failed
                  to load — every task using {failedConnectors.length === 1 ? "it" : "them"} is failing:
                </span>
                {failedConnectors.map((c) =>
                  lens === "deps" ? (
                    <button
                      key={c.name}
                      type="button"
                      onClick={() => revealHub(`connector:${c.name}`)}
                      className="rounded font-mono underline underline-offset-2 hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
                    >
                      {c.name} · {c.users.length} channel{c.users.length === 1 ? "" : "s"}
                    </button>
                  ) : (
                    <Link
                      key={c.name}
                      to={c.known ? `/connectors/${c.refId}?test=1` : "/connectors"}
                      className="rounded font-mono underline underline-offset-2 hover:opacity-80"
                    >
                      {c.name} · {c.users.length} channel{c.users.length === 1 ? "" : "s"}
                    </Link>
                  ),
                )}
              </div>
            )}
          </div>
        </Callout>
      )}

      {/* Why a map may be quiet, by the feed's state. Loading is not "off":
          a large instance's first scrape takes seconds. */}
      {traffic.state === "off" ? (
        <Callout variant="muted" className="py-2 text-xs">
          Metrics are off on this server (<code className="font-mono">[metrics]</code> in the engine
          config), so the map shows structure only — {lens === "deps" ? "every edge is a static reference, with no rates or health" : "no rates, no health, no latency"}.
        </Callout>
      ) : traffic.state === "error" ? (
        <Callout variant="warning" className="py-2 text-xs">
          The metrics endpoint is not answering. The map shows structure
          {traffic.available ? " and the last sample it read" : " only"} until it does.
        </Callout>
      ) : (
        traffic.state === "live" &&
        traffic.activeCount === 0 && (
          <Callout variant="muted" className="py-2 text-xs">
            No channel has carried traffic in the {spanLabel}. Send a request from the{" "}
            <Link to="/console" className="underline underline-offset-2">
              Data Console
            </Link>{" "}
            and it will light up here.
          </Callout>
        )
      )}

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Card className="relative min-h-[50vh] overflow-hidden p-0 lg:min-h-0">
          {lens === "deps" ? (
            <DependencyMap
              graph={graph}
              dg={dg}
              traffic={traffic}
              connectorTraffic={connectorTraffic}
              selectedId={selectedId}
              sizeMetric={sizeMetric}
              colorMetric={colorMetric}
              faults={faults}
              pins={pins}
              highlight={matches}
              revealToken={revealToken}
              onSelect={setSelectedId}
            />
          ) : lens === "grid" ? (
            <HealthGrid
              graph={graph}
              nodes={viewNodes}
              domains={dg.domainIndex}
              traffic={traffic}
              colorMetric={colorMetric}
              sizeMetric={sizeMetric}
              faults={faults}
              pins={pins}
              selectedId={selectedId}
              highlight={matches}
              revealToken={revealToken}
              onSelect={setSelectedId}
            />
          ) : (
            <TrafficMap
              graph={graph}
              traffic={traffic}
              visible={visible}
              selectedId={selectedId}
              sizeMetric={sizeMetric}
              colorMetric={colorMetric}
              revealToken={revealToken}
              faults={faults}
              hops={hops}
              highlight={matches}
              nextFire={nextFire}
              pins={pins}
              onSelect={(node) => setSelectedId(node?.id ?? null)}
            />
          )}
          <div className="pointer-events-none absolute bottom-3 left-3 max-w-[calc(100%-1.5rem)] truncate rounded-md border bg-card/90 px-2 py-1 text-xs text-muted-foreground shadow-xs backdrop-blur">
            {footer}
          </div>
        </Card>

        <Card className="hidden min-h-0 overflow-hidden p-0 lg:block">
          {wide && inspector ? inspector : <InspectorPlaceholder activeCount={traffic.activeCount} lens={lens} />}
        </Card>
      </div>

      {/* Below `lg` the inspector column is gone; the same panel rises as a
          sheet, so a selection on a laptop split screen is not a dim canvas
          and nothing else. */}
      {!wide && inspector && (
        <div
          className="fixed inset-x-0 bottom-0 z-40 h-[55vh] overflow-hidden rounded-t-xl border-t bg-card shadow-lg lg:hidden"
          role="dialog"
          aria-label={`${selectedHub?.name ?? selected?.name ?? ""} on the map`}
        >
          {inspector}
        </div>
      )}

      {/* On the calls lens connectors ride the nodes that reference them rather
          than being nodes, so their fan-in is a strip here. The dependencies
          lens draws them as hubs, and the strip would repeat it. */}
      {lens === "calls" && graph.connectors.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="flex items-center gap-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            <Plug className="h-3 w-3" />
            Connectors
          </span>
          {graph.connectors.map((c) => {
            const failed = faults.failedConnectors.has(c.name)
            return (
              <Link
                key={c.name}
                to={c.known ? `/connectors/${c.refId}${failed ? "?test=1" : ""}` : "/connectors"}
                title={failed ? "Failed to load — every task using it is failing" : undefined}
              >
                <Badge
                  variant="outline"
                  className={cn(
                    "gap-1 text-xs transition-colors hover:bg-accent",
                    !c.known && "border-dashed",
                    c.known && !c.enabled && "opacity-60",
                    failed && "border-destructive/60 text-destructive",
                  )}
                >
                  {failed && <Unplug className="h-3 w-3" />}
                  {c.name}
                  <span className="font-mono text-muted-foreground">{c.users.length}</span>
                </Badge>
              </Link>
            )
          })}
        </div>
      )}

      {helpOpen && <MapHelpDialog colorMetric={colorMetric} onClose={() => setHelpOpen(false)} />}
    </div>
  )
}
