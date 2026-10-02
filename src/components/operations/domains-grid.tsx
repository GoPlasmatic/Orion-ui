import { useMemo } from "react"
import { Link } from "react-router"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import type { ChannelTraffic, MetricsState } from "@/hooks/use-metrics"
import type { DomainIndex } from "@/lib/domains"
import type { SystemNode } from "@/lib/system-graph"
import { buildHealthGrid } from "@/lib/health-grid"
import { healthDot, legendFor, trafficLine, worstLevel, type HealthLevel } from "@/lib/traffic-encoding"
import { cn, plural } from "@/lib/utils"

const LEGEND = legendFor("health")
const LEGEND_LABEL = new Map(LEGEND.map((e) => [e.level, e.label]))
const NO_TRAFFIC = new Map<string, ChannelTraffic>()

/**
 * The map's health-grid lens as a summary: one tile per domain, one cell per
 * active channel in name order, coloured by health over the window. A domain
 * with a failing channel is outlined; a click opens the map on that domain.
 */
export function DomainsGrid({
  index,
  nodes,
  traffic,
  state,
  quarantined,
  incidentChannels,
  recovering,
  loading = false,
  className,
}: {
  index: DomainIndex
  nodes: SystemNode[]
  traffic: ReadonlyMap<string, ChannelTraffic>
  state: MetricsState
  /** Channel names refused at load. */
  quarantined: ReadonlySet<string>
  /** Channel names in an open incident. */
  incidentChannels: ReadonlySet<string>
  /** Channel names in an incident that has since recovered. */
  recovering: ReadonlySet<string>
  loading?: boolean
  className?: string
}) {
  const measured = state === "live"
  const domains = useMemo(() => {
    const cron = new Set(nodes.filter((n) => n.protocol === "cron").map((n) => n.id))
    const sections = buildHealthGrid({
      nodes,
      domains: index,
      // Before two samples the counters are cumulative, not health.
      byChannel: measured ? traffic : NO_TRAFFIC,
      colorMetric: "health",
      sizeMetric: "uniform",
    })
    return sections.map((s) => {
      const cells = s.tiles.map((t) => ({
        id: t.id,
        label: t.label,
        level: worstLevel([
          t.level,
          quarantined.has(t.id) ? "critical" : "idle",
          incidentChannels.has(t.id) ? "warning" : "idle",
        ] as HealthLevel[]),
      }))
      const level = worstLevel(cells.map((c) => c.level))
      const failing = cells.filter((c) => c.level === "critical" || c.level === "warning").length
      const allCron = cells.every((c) => cron.has(c.id))
      const parts = [allCron ? `${cells.length} cron` : plural(cells.length, "channel")]
      if (failing) parts.push(`${failing} failing`)
      else if (cells.some((c) => recovering.has(c.id))) parts.push("recovering")
      else if (measured && s.load.active) parts.push(`${s.load.active} serving`)
      return {
        domain: s.domain,
        cells,
        level,
        failing,
        summary: parts.join(" · "),
        line: trafficLine({ ratePerMin: s.load.rate, errorPct: s.load.errorPct, p95Ms: s.load.worstP95Ms }),
      }
    })
  }, [nodes, index, traffic, measured, quarantined, incidentChannels, recovering])

  return (
    <Card className={cn("flex min-h-0 flex-col", className)}>
      <CardHeader className="flex h-[3.25rem] shrink-0 flex-row items-center justify-between gap-3 pb-2">
        <CardTitle>Domains</CardTitle>
        <span className="flex flex-wrap items-center justify-end gap-x-2.5 gap-y-1 text-[11px] text-muted-foreground">
          {LEGEND.map((e) => (
            <span key={e.level} className="inline-flex items-center gap-1">
              <span className={cn("h-2 w-2 rounded-[2px]", healthDot[e.level])} aria-hidden="true" />
              {e.label}
            </span>
          ))}
        </span>
      </CardHeader>
      <CardContent className="min-h-0 flex-1">
        {loading ? (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {Array.from({ length: 6 }, (_, k) => (
              <Skeleton key={k} className="h-20" />
            ))}
          </div>
        ) : domains.length === 0 ? (
          <p className="py-4 text-sm text-muted-foreground">No active channel.</p>
        ) : (
          <>
            <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3" aria-label="Domains">
              {domains.map((d) => (
                <li key={d.domain}>
                  <Link
                    to={`/system-map?lens=grid&q=${encodeURIComponent(`${index.prefix}${d.domain}`)}`}
                    className={cn(
                      "flex h-full flex-col gap-1.5 rounded-lg border p-2.5 transition-colors outline-none hover:border-border-strong hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring/60",
                      d.level === "critical" ? "border-destructive/70" : d.level === "warning" && "border-warning/70",
                    )}
                    title={d.line || undefined}
                    aria-label={`${d.domain}: ${d.summary}. Open on the map`}
                  >
                    <span className="truncate text-sm font-medium">{d.domain}</span>
                    <span
                      className={cn(
                        "truncate text-xs",
                        d.level === "critical" ? "text-destructive" : d.failing ? "text-warning" : "text-muted-foreground",
                      )}
                    >
                      {d.summary}
                    </span>
                    <span className="flex flex-wrap gap-[3px]" aria-hidden="true">
                      {d.cells.map((c) => (
                        <span
                          key={c.id}
                          className={cn("h-2.5 w-2.5 rounded-[2px]", healthDot[c.level])}
                          title={`${c.label} · ${LEGEND_LABEL.get(c.level) ?? c.level}`}
                        />
                      ))}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
            {!measured && (
              <p className="mt-2 text-xs text-muted-foreground">
                {state === "loading" || state === "warming"
                  ? "Health colours arrive with the second metrics sample."
                  : "Without metrics only quarantines and incidents colour a cell."}
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}
