import { Link } from "react-router"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import type { CircuitBreakerStatus, CronScheduleStatus } from "@/api/types"
import type { SubsystemMetrics } from "@/hooks/use-ops-metrics"
import {
  breakerTile,
  cacheTile,
  cronTile,
  dbPoolTile,
  dlqTile,
  rateLimitTile,
  tracePipelineTile,
  type TileModel,
  type TileTone,
} from "@/components/operations/subsystem-tiles"
import { cn } from "@/lib/utils"

const TONE: Record<TileTone, string> = {
  plain: "text-foreground",
  warning: "text-warning",
  destructive: "text-destructive",
  muted: "text-muted-foreground",
}

/** Every subsystem's state in one row, each tile opening its own page. */
export function SubsystemsRow({
  subsystems,
  hasCron,
  cronEnabled,
  schedules,
  oldestPendingSec,
  label,
  breakers,
  dlqDepth,
  dlqExhausted,
  windowLabel,
  now,
}: {
  subsystems: SubsystemMetrics
  hasCron: boolean
  /** `engine/status.capabilities.cron`; undefined from a pre-1.9 server. */
  cronEnabled: boolean | undefined
  schedules: CronScheduleStatus[] | undefined
  oldestPendingSec: number | null | undefined
  label?: (name: string) => string
  breakers: CircuitBreakerStatus | undefined
  dlqDepth: number | null
  dlqExhausted: number | null
  windowLabel: string
  now: number
}) {
  const { state } = subsystems
  const windowed = state === "live"
  const gaugeDepth = state === "live" || state === "warming" ? subsystems.traces.dlqDepth : null

  return (
    <Card>
      <CardHeader className="flex h-[3.25rem] flex-row items-center justify-between pb-2">
        <CardTitle>Subsystems</CardTitle>
        <span className="text-xs text-muted-foreground">each one opens its own page</span>
      </CardHeader>
      <CardContent>
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-7" aria-label="Subsystems">
          <Tile
            name="Cron"
            to="/schedules"
            model={cronTile({ hasCron, cronEnabled, schedules, oldestPendingSec, now, label })}
          />
          <Tile name="Response cache" to="/caches" model={cacheTile(subsystems.cache, state, windowed)} />
          <Tile name="Rate limits" to="/system-map" model={rateLimitTile(subsystems.rateLimit, state, windowLabel)} />
          <Tile
            name="Breakers"
            to="/circuit-breakers"
            model={breakerTile(breakers, subsystems.breakers.trips, windowed)}
          />
          <Tile name="Trace DLQ" to="/trace-dlq" model={dlqTile(dlqDepth ?? gaugeDepth, dlqExhausted)} />
          <Tile name="Trace pipeline" to="/traces" model={tracePipelineTile(subsystems.traces, state, windowLabel)} />
          <Tile name="DB pool" to="/engine#component-database" model={dbPoolTile(subsystems.dbPool, state)} />
        </ul>
      </CardContent>
    </Card>
  )
}

function Tile({ name, to, model }: { name: string; to: string; model: TileModel }) {
  return (
    <li>
      <Link
        to={to}
        title={model.title}
        className="flex h-full flex-col gap-0.5 rounded-lg border p-2.5 transition-colors outline-none hover:border-border-strong hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring/60"
      >
        <span className="text-xs text-muted-foreground">{name}</span>
        <span className={cn("truncate text-sm font-semibold tabular-nums", TONE[model.tone])}>{model.value}</span>
        <span className="truncate text-xs text-muted-foreground">{model.sub}</span>
      </Link>
    </li>
  )
}
