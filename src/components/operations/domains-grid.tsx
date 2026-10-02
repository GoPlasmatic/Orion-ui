import { Link } from "react-router"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import type { ChannelTraffic, MetricsState } from "@/hooks/use-metrics"
import type { DomainIndex } from "@/lib/domains"
import { shortName } from "@/lib/domains"
import { healthDot, healthOf, type HealthLevel } from "@/lib/traffic-encoding"
import { cn } from "@/lib/utils"

const LEVEL_RANK: Record<HealthLevel, number> = { critical: 0, warning: 1, notice: 2, healthy: 3, idle: 4 }
const LEVEL_WORD: Record<HealthLevel, string> = {
  critical: "failing",
  warning: "erroring",
  notice: "mostly rejected",
  healthy: "serving",
  idle: "idle",
}
const LEGEND: HealthLevel[] = ["healthy", "notice", "warning", "critical", "idle"]

export interface DomainChannel {
  name: string
  cron: boolean
}

/**
 * The map's health-grid lens as a summary: one tile per domain, one cell per
 * active channel coloured by its health in the window. A domain with a failing
 * channel is outlined; a click opens the map on that domain.
 */
export function DomainsGrid({
  index,
  channels,
  traffic,
  state,
  quarantined,
  incidentChannels,
  recovering,
  loading = false,
  className,
}: {
  index: DomainIndex
  channels: Map<string, DomainChannel>
  traffic: Map<string, ChannelTraffic>
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
  const levelOf = (name: string): HealthLevel => {
    if (quarantined.has(name)) return "critical"
    const base = measured ? healthOf(traffic.get(name)) : "idle"
    if (incidentChannels.has(name) && LEVEL_RANK[base] > LEVEL_RANK.warning) return "warning"
    return base
  }

  const domains = [...index.members.entries()].map(([domain, members]) => {
    const cells = members
      .map((name) => ({ name, level: levelOf(name), rate: traffic.get(name)?.ratePerMin ?? 0 }))
      .sort((a, b) => LEVEL_RANK[a.level] - LEVEL_RANK[b.level] || b.rate - a.rate || a.name.localeCompare(b.name))
    const failing = cells.filter((c) => c.level === "critical" || c.level === "warning").length
    const critical = cells.some((c) => c.level === "critical")
    const serving = cells.filter((c) => c.level !== "idle").length
    const allCron = members.every((m) => channels.get(m)?.cron)
    const isRecovering = !failing && members.some((m) => recovering.has(m))
    const noun = allCron ? "cron" : members.length === 1 ? "channel" : "channels"
    const parts = [`${members.length} ${noun}`]
    if (failing) parts.push(`${failing} failing`)
    else if (isRecovering) parts.push("recovering")
    else if (measured && serving) parts.push(`${serving} serving`)
    return { domain, cells, failing, critical, summary: parts.join(" · ") }
  })

  return (
    <Card className={cn("flex min-h-0 flex-col", className)}>
      <CardHeader className="flex h-[3.25rem] shrink-0 flex-row items-center justify-between gap-3 pb-2">
        <CardTitle>Domains</CardTitle>
        <span className="flex flex-wrap items-center justify-end gap-x-2.5 gap-y-1 text-[11px] text-muted-foreground">
          {LEGEND.map((l) => (
            <span key={l} className="inline-flex items-center gap-1">
              <span className={cn("h-2 w-2 rounded-[2px]", healthDot[l])} aria-hidden="true" />
              {LEVEL_WORD[l]}
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
                      d.critical
                        ? "border-destructive/70"
                        : d.failing > 0
                          ? "border-warning/70"
                          : undefined,
                    )}
                    aria-label={`${d.domain}: ${d.summary}. Open on the map`}
                  >
                    <span className="truncate text-sm font-medium" title={`${index.prefix}${d.domain}`}>
                      {d.domain}
                    </span>
                    <span
                      className={cn(
                        "truncate text-xs",
                        d.critical ? "text-destructive" : d.failing ? "text-warning" : "text-muted-foreground",
                      )}
                    >
                      {d.summary}
                    </span>
                    <span className="flex flex-wrap gap-[3px]" aria-hidden="true">
                      {d.cells.map((c) => (
                        <span
                          key={c.name}
                          className={cn("h-2.5 w-2.5 rounded-[2px]", healthDot[c.level])}
                          title={`${shortName(c.name, index)} · ${LEVEL_WORD[c.level]}`}
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
