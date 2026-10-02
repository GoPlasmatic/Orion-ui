import { memo, useEffect, useMemo, useRef } from "react"
import { Pin } from "lucide-react"
import { cn } from "@/lib/utils"
import { buildHealthGrid, TILE_H, type GridSection, type GridTile } from "@/lib/health-grid"
import type { DomainIndex } from "@/lib/domains"
import type { SystemGraph, SystemNode } from "@/lib/system-graph"
import type { TrafficWindow } from "@/hooks/use-metrics"
import { faultsFor, worstTone, type MapFaults } from "@/lib/faults"
import { pinTitle, type ChangePins } from "@/lib/change-pins"
import {
  deriveLoad,
  formatMs,
  healthDot,
  trafficLine,
  type ColorMetric,
  type SizeMetric,
} from "@/lib/traffic-encoding"

/**
 * The health grid lens: every channel as a tile under its domain. Plain DOM —
 * a CSS flex wrap scales to 500 tiles where a node-link canvas does not, and
 * scrolls like a page. A tile is a button: Tab reaches it, Enter selects it.
 */
export interface HealthGridProps {
  graph: SystemGraph
  nodes: SystemNode[]
  domains: DomainIndex
  traffic: TrafficWindow
  colorMetric: ColorMetric
  sizeMetric: SizeMetric
  faults: MapFaults
  pins?: ChangePins
  selectedId: string | null
  highlight?: ReadonlySet<string> | null
  /** Bumped when a selection comes from outside the grid; the grid scrolls to it. */
  revealToken: number
  onSelect: (id: string | null) => void
}

interface TileProps {
  tile: GridTile
  title: string
  tone: "destructive" | "warning" | null
  pinned: boolean
  selected: boolean
  dimmed: boolean
  onSelect: (id: string | null) => void
}

const Tile = memo(function Tile({ tile, title, tone, pinned, selected, dimmed, onSelect }: TileProps) {
  return (
    <button
      type="button"
      data-tile={tile.id}
      onClick={() => onSelect(selected ? null : tile.id)}
      title={title}
      aria-pressed={selected}
      style={{ width: tile.width, height: TILE_H }}
      className={cn(
        "relative flex shrink-0 items-center gap-2 overflow-hidden rounded-md border bg-card px-2.5 text-left shadow-xs transition-opacity hover:border-border-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60",
        tone === "destructive" && "border-destructive/70",
        tone === "warning" && "border-warning/70",
        selected && "border-primary ring-2 ring-ring/60",
        dimmed && "opacity-25",
      )}
    >
      <span className={cn("absolute inset-y-0 left-0 w-1", healthDot[tile.level])} aria-hidden />
      <span className={cn("ml-0.5 h-2.5 w-2.5 shrink-0 rounded-full", healthDot[tile.level])} aria-hidden />
      <span className="min-w-0 flex-1 overflow-hidden whitespace-nowrap text-xs font-medium">{tile.label}</span>
      {pinned && <Pin className="h-3 w-3 shrink-0 text-info" aria-hidden />}
    </button>
  )
})

function SectionHeader({ section }: { section: GridSection }) {
  const { load } = section
  return (
    <div className="mb-2 flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
      <span className="flex items-center gap-1.5">
        <span className={cn("h-2.5 w-2.5 rounded-full", healthDot[section.level])} aria-hidden />
        <span className="font-display text-sm font-semibold">{section.domain}</span>
        <span className="font-mono text-xs tabular-nums text-muted-foreground">{section.tiles.length}</span>
      </span>
      <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
        {load.windowed === 0
          ? "idle in the window"
          : `${trafficLine({ ratePerMin: load.rate, errorPct: load.errorPct })}${load.worstP95Ms != null ? ` · slowest p95 ${formatMs(load.worstP95Ms)}` : ""} · ${load.active} active`}
      </span>
    </div>
  )
}

export function HealthGrid({
  graph,
  nodes,
  domains,
  traffic,
  colorMetric,
  sizeMetric,
  faults,
  pins,
  selectedId,
  highlight = null,
  revealToken,
  onSelect,
}: HealthGridProps) {
  const load = useMemo(() => deriveLoad(graph, traffic.byChannel), [graph, traffic.byChannel])
  const sections = useMemo(
    () => buildHealthGrid({ nodes, domains, byChannel: traffic.byChannel, load, colorMetric, sizeMetric }),
    [nodes, domains, traffic.byChannel, load, colorMetric, sizeMetric],
  )
  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes])

  // Scroll a selection named elsewhere (search, the failing strip) into view.
  // A token is honoured once, like the canvases' reveal: clicking a tile
  // changes the selection without scrolling.
  const root = useRef<HTMLDivElement>(null)
  const handled = useRef(0)
  useEffect(() => {
    if (!revealToken || revealToken === handled.current || !selectedId) return
    const el = root.current?.querySelector<HTMLElement>(`[data-tile="${CSS.escape(selectedId)}"]`)
    if (!el) return
    handled.current = revealToken
    el.scrollIntoView({ block: "nearest", behavior: "smooth" })
    el.focus({ preventScroll: true })
  }, [revealToken, selectedId])

  if (sections.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-sm text-muted-foreground">
        No channel matches the filters.
      </div>
    )
  }

  return (
    <div
      ref={root}
      className="h-full space-y-5 overflow-y-auto p-4 pb-12"
      onKeyDown={(e) => {
        if (e.key === "Escape") onSelect(null)
      }}
    >
      {sections.map((section) => (
        <section key={section.domain} aria-label={`${section.domain}, ${section.tiles.length} channels`}>
          <SectionHeader section={section} />
          <div className="flex flex-wrap gap-1.5">
            {section.tiles.map((tile) => {
              const node = byId.get(tile.id)
              const t = traffic.byChannel.get(tile.id)
              const f = node ? faultsFor(node, faults) : []
              const pin = pinTitle(pins?.get(tile.id))
              const figures = t && t.windowed > 0 ? ` · ${trafficLine(t)}` : " · no traffic in the window"
              const title = [`${tile.id}${figures}`, ...f.map((x) => x.detail), ...(pin ? [pin] : [])].join("\n")
              return (
                <Tile
                  key={tile.id}
                  tile={tile}
                  title={title}
                  tone={worstTone(f)}
                  pinned={!!pin}
                  selected={selectedId === tile.id}
                  dimmed={!!highlight && !highlight.has(tile.id)}
                  onSelect={onSelect}
                />
              )
            })}
          </div>
        </section>
      ))}
    </div>
  )
}
