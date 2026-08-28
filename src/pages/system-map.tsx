import { useMemo, useState } from "react"
import { Link } from "react-router"
import { useChannels } from "@/hooks/use-channels"
import { useWorkflows } from "@/hooks/use-workflows"
import { useConnectors } from "@/hooks/use-connectors"
import { useChannelTraffic } from "@/hooks/use-metrics"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Callout } from "@/components/ui/callout"
import { PageHeader } from "@/components/shared/page-header"
import { FilterBar } from "@/components/shared/filter-bar"
import { EmptyState } from "@/components/shared/empty-state"
import { TrafficMap } from "@/components/graph/traffic-map"
import { InspectorPlaceholder, MapInspector } from "@/components/graph/map-inspector"
import { buildIndex } from "@/lib/topology"
import { buildSystemGraph } from "@/lib/system-graph"
import {
  COLOR_METRICS,
  SIZE_METRICS,
  deriveLoad,
  formatPct,
  healthDot,
  healthLabel,
  type ColorMetric,
  type HealthLevel,
  type SizeMetric,
} from "@/lib/traffic-encoding"
import { cn } from "@/lib/utils"
import { AlertTriangle, Network, Pause, Play, Plug, Search } from "lucide-react"

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
 */

/**
 * Bounded by the metrics ring buffer — 60 samples at a 10s poll. Asking for
 * longer than the buffer holds would report a window it cannot actually cover.
 */
const WINDOWS = [
  { value: 60, label: "1 min" },
  { value: 300, label: "5 min" },
  { value: 600, label: "10 min" },
]

type LifecycleFilter = "active" | "all"

function formatSpan(seconds: number): string {
  if (seconds <= 0) return "waiting for a second sample"
  if (seconds < 90) return `last ${Math.round(seconds)}s`
  return `last ${Math.round(seconds / 60)}m`
}

function LegendSwatch({ level }: { level: HealthLevel }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={cn("h-2 w-2 rounded-full", healthDot[level])} />
      <span className="text-muted-foreground">{healthLabel[level]}</span>
    </span>
  )
}

export function SystemMapPage() {
  const { data: channels, isLoading } = useChannels({ limit: 1000 })
  const { data: workflows } = useWorkflows({ limit: 1000 })
  const { data: connectors } = useConnectors({ limit: 1000 })

  const [windowSec, setWindowSec] = useState(300)
  const [paused, setPaused] = useState(false)
  const [lifecycle, setLifecycle] = useState<LifecycleFilter>("active")
  const [sizeMetric, setSizeMetric] = useState<SizeMetric>("rate")
  const [colorMetric, setColorMetric] = useState<ColorMetric>("health")
  const [search, setSearch] = useState("")
  const [tag, setTag] = useState("")
  const [selectedId, setSelectedId] = useState<string | null>(null)
  // Selections made from a list rather than the canvas ask the canvas to travel.
  const [revealToken, setRevealToken] = useState(0)

  function revealChannel(id: string) {
    setSelectedId(id)
    setRevealToken((t) => t + 1)
  }

  const traffic = useChannelTraffic(windowSec, paused)

  const idx = useMemo(
    () => buildIndex(channels?.data ?? [], workflows?.data ?? [], connectors?.data ?? []),
    [channels?.data, workflows?.data, connectors?.data],
  )
  const graph = useMemo(() => buildSystemGraph(idx), [idx])
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
    const term = search.trim().toLowerCase()
    let seeds = graph.nodes

    if (lifecycle === "active") seeds = seeds.filter((n) => n.status === "active")
    if (tag) seeds = seeds.filter((n) => n.tags.includes(tag))
    if (term) {
      seeds = seeds.filter(
        (n) =>
          n.name.toLowerCase().includes(term) ||
          (n.route ?? "").toLowerCase().includes(term) ||
          (n.workflowName ?? "").toLowerCase().includes(term) ||
          n.tags.some((t) => t.toLowerCase().includes(term)),
      )
    }

    const ids = new Set(seeds.map((n) => n.id))
    for (const node of seeds) {
      for (const other of [...node.callers, ...node.callees]) ids.add(other)
    }
    return ids
  }, [graph.nodes, lifecycle, tag, search])

  const selected = selectedId ? (graph.byId.get(selectedId) ?? null) : null

  // Channels the window says are actually broken, as opposed to merely refusing
  // unauthenticated callers.
  const failing = useMemo(
    () =>
      traffic.channels
        .filter((c) => c.failed > 0 && c.errorPct != null && c.errorPct >= 1)
        .sort((a, b) => (b.errorPct ?? 0) - (a.errorPct ?? 0)),
    [traffic.channels],
  )

  const spanLabel = traffic.hasRate ? formatSpan(traffic.spanSec) : "waiting for a second sample"

  if (isLoading) {
    return (
      <div className="flex h-full flex-col gap-4">
        <PageHeader title="System Map" description="Live traffic across the channel call graph" />
        <Skeleton className="min-h-0 flex-1" />
      </div>
    )
  }

  if (graph.nodes.length === 0) {
    return (
      <div className="flex h-full flex-col gap-4">
        <PageHeader title="System Map" description="Live traffic across the channel call graph" />
        <EmptyState
          icon={Network}
          title="Nothing to map yet"
          description="Create a channel and the map will show it, what it calls, and what it is carrying."
        />
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col gap-3">
      <PageHeader
        title="System Map"
        description="Every live channel, entry points on the left and what they call to the right — dot size is throughput, colour is health"
      >
        <Button
          variant={paused ? "outline" : "secondary"}
          size="sm"
          onClick={() => setPaused((p) => !p)}
        >
          {paused ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
          {paused ? "Paused" : "Live"}
        </Button>
        <Select
          value={String(windowSec)}
          onChange={(e) => setWindowSec(Number(e.target.value))}
          className="w-28"
          aria-label="Traffic window"
        >
          {WINDOWS.map((w) => (
            <option key={w.value} value={w.value}>
              {w.label}
            </option>
          ))}
        </Select>
      </PageHeader>

      <FilterBar>
        <div className="relative w-full sm:w-56">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search channels, routes, tags…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8"
          />
        </div>
        <Select
          value={lifecycle}
          onChange={(e) => setLifecycle(e.target.value as LifecycleFilter)}
          className="w-full sm:w-40"
          aria-label="Lifecycle"
        >
          <option value="active">Live channels</option>
          <option value="all">All lifecycles</option>
        </Select>
        {graph.tags.length > 0 && (
          <Select
            value={tag}
            onChange={(e) => setTag(e.target.value)}
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
        <Select
          value={sizeMetric}
          onChange={(e) => setSizeMetric(e.target.value as SizeMetric)}
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
          onChange={(e) => setColorMetric(e.target.value as ColorMetric)}
          className="w-full sm:w-36"
          aria-label="Colour by"
        >
          {COLOR_METRICS.map((m) => (
            <option key={m.value} value={m.value}>
              Colour: {m.label}
            </option>
          ))}
        </Select>

        <div className="ml-auto hidden items-center gap-3 text-[11px] lg:flex">
          <LegendSwatch level="healthy" />
          <LegendSwatch level="warning" />
          <LegendSwatch level="critical" />
          <LegendSwatch level="rejected" />
          <LegendSwatch level="idle" />
        </div>
      </FilterBar>

      {failing.length > 0 && (
        <Callout variant="destructive" className="py-2">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
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
        </Callout>
      )}

      {traffic.activeCount === 0 && (
        <Callout variant="muted" className="py-2 text-xs">
          No channel has carried traffic in the {spanLabel}. Send a request from the{" "}
          <Link to="/console" className="underline underline-offset-2">
            Data Console
          </Link>{" "}
          and it will light up here.
        </Callout>
      )}

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Card className="relative min-h-0 overflow-hidden p-0">
          <TrafficMap
            graph={graph}
            traffic={traffic}
            visible={visible}
            selectedId={selectedId}
            sizeMetric={sizeMetric}
            colorMetric={colorMetric}
            revealToken={revealToken}
            onSelect={(node) => setSelectedId(node?.id ?? null)}
          />
          <div className="pointer-events-none absolute bottom-3 left-3 rounded-md border bg-card/90 px-2 py-1 text-[10px] text-muted-foreground shadow-xs backdrop-blur">
            {visible.size} of {graph.nodes.length} channels · {traffic.activeCount} carrying
            traffic · {spanLabel}
          </div>
        </Card>

        <Card className="hidden min-h-0 overflow-hidden p-0 lg:block">
          {selected ? (
            <MapInspector
              node={selected}
              traffic={traffic.byChannel.get(selected.id)}
              load={load.get(selected.id)}
              graph={graph}
              connectorsByName={connectorsByName}
              spanLabel={spanLabel}
              onSelect={(node) => revealChannel(node.id)}
              onClose={() => setSelectedId(null)}
            />
          ) : (
            <InspectorPlaceholder activeCount={traffic.activeCount} />
          )}
        </Card>
      </div>

      {/* Connectors ride the nodes that reference them rather than being nodes:
          one used by 51 of 62 workflows would add an edge everywhere and
          distinguish nothing. Fan-in is the interesting number, so show that. */}
      {graph.connectors.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="flex items-center gap-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            <Plug className="h-3 w-3" />
            Connectors
          </span>
          {graph.connectors.map((c) => (
            <Link key={c.name} to={c.known ? `/connectors/${c.refId}` : "/connectors"}>
              <Badge
                variant="outline"
                className={cn(
                  "gap-1 text-[10px] transition-colors hover:bg-accent",
                  !c.known && "border-dashed",
                  c.known && !c.enabled && "opacity-60",
                )}
              >
                {c.name}
                <span className="font-mono text-muted-foreground">{c.users.length}</span>
              </Badge>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
