import type { ReactNode } from "react"
import { Link } from "react-router"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import type { CircuitBreakerStatus, CronScheduleStatus } from "@/api/types"
import type { MetricsState } from "@/hooks/use-metrics"
import { isPolicyDrop, type SubsystemMetrics } from "@/hooks/use-ops-metrics"
import { openBreakers } from "@/lib/breakers"
import { cn, formatDate, formatRelative, serverTime } from "@/lib/utils"

type Tone = "plain" | "warning" | "destructive" | "muted"

const TONE: Record<Tone, string> = {
  plain: "text-foreground",
  warning: "text-warning",
  destructive: "text-destructive",
  muted: "text-muted-foreground",
}

/** What a metric-backed tile says while there is no figure to show. */
const NO_FIGURE: Record<MetricsState, string> = {
  loading: "loading metrics",
  warming: "after the next sample",
  live: "—",
  off: "metrics off",
  error: "metrics unreachable",
}

/**
 * Every subsystem's state in one row, each tile opening its own page: the
 * scheduler, the response cache, rate limiting, breakers, the trace DLQ, the
 * trace pipeline and the database pool. Replaces the four large backlog tiles
 * and reads metric families the console did not read before.
 */
export function SubsystemsRow({
  subsystems,
  hasCron,
  cronEnabled,
  schedules,
  label = (name) => name,
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
  label?: (name: string) => string
  breakers: CircuitBreakerStatus | undefined
  dlqDepth: number | null
  dlqExhausted: number | null
  windowLabel: string
  now: number
}) {
  const state = subsystems.state
  const hasFigures = state === "live" || state === "warming"
  const windowed = state === "live"

  // Cron
  let cron: { value: string; sub: ReactNode; tone: Tone; title?: string }
  if (!hasCron || cronEnabled === false) {
    cron = { value: "off", sub: "no scheduler on this node", tone: "muted" }
  } else if (!schedules) {
    cron = { value: "…", sub: "reading schedules", tone: "muted" }
  } else {
    const backlog = schedules.reduce((n, s) => n + (s.pending ?? 0), 0)
    const late = schedules.filter((s) => s.last_status === "failed" || s.last_status?.startsWith("skipped"))
    const onTime = schedules.length - late.length
    const next = schedules
      .map((s) => ({ s, at: serverTime(s.next_fire_at) }))
      .filter((x): x is { s: CronScheduleStatus; at: number } => x.at != null && x.at >= now - 5_000)
      .sort((a, b) => a.at - b.at)[0]
    cron = {
      value: schedules.length === 0 ? "none active" : `${onTime} on time · ${backlog} backlog`,
      sub: next ? (
        <>
          next: {label(next.s.channel_name)}{" "}
          <time title={formatDate(next.at)}>{formatRelative(next.at, now)}</time>
        </>
      ) : (
        "nothing scheduled"
      ),
      tone: late.length > 0 ? "warning" : backlog > 0 ? "warning" : schedules.length === 0 ? "muted" : "plain",
      title: late.length ? `Last run did not complete: ${late.map((s) => s.channel_name).join(", ")}` : undefined,
    }
  }

  // Response cache
  const cache = subsystems.cache
  const cacheTile = !hasFigures
    ? { value: "—", sub: NO_FIGURE[state], tone: "muted" as Tone }
    : !cache.seen
      ? { value: "no cached channels", sub: "no channel has looked up the cache", tone: "muted" as Tone }
      : {
          value: cache.hitPct == null ? "—" : `hit ${cache.hitPct.toFixed(0)}%`,
          sub: `${cache.byChannel.size} channel${cache.byChannel.size === 1 ? "" : "s"}${
            windowed && cache.coalesced != null && cache.coalesced > 0 ? ` · ${cache.coalesced} coalesced` : ""
          }`,
          tone: "plain" as Tone,
        }

  // Rate limits
  const rl = subsystems.rateLimit
  const topScope = [...rl.byScope.entries()].sort((a, b) => b[1] - a[1])[0]
  const rateTile = !windowed
    ? { value: "—", sub: NO_FIGURE[state], tone: "muted" as Tone }
    : {
        value: `${(rl.rejections ?? 0).toLocaleString()} rejected`,
        sub: topScope ? `mostly ${topScope[0]} · last ${windowLabel}` : `last ${windowLabel}`,
        tone: (rl.rejections ?? 0) > 0 ? ("warning" as Tone) : ("plain" as Tone),
      }

  // Breakers
  const open = openBreakers(breakers).length
  const breakerTile = !breakers
    ? { value: "…", sub: "reading this node's map", tone: "muted" as Tone }
    : !breakers.enabled
      ? { value: "disabled", sub: "on this engine", tone: "muted" as Tone }
      : {
          value: open > 0 ? `${open} open` : "all closed",
          sub: `${Object.keys(breakers.breakers ?? {}).length} tracked${
            windowed && subsystems.breakers.trips ? ` · ${subsystems.breakers.trips} trips` : ""
          } · this node`,
          tone: open > 0 ? ("warning" as Tone) : ("plain" as Tone),
        }

  // Trace DLQ — the list's own count first, the gauge as a fallback.
  const depth = dlqDepth ?? (hasFigures ? subsystems.traces.dlqDepth : null)
  const dlqTile =
    depth == null
      ? { value: "…", sub: "reading the queue", tone: "muted" as Tone }
      : {
          value: depth === 0 ? "empty" : `${depth.toLocaleString()} waiting`,
          sub: `${(dlqExhausted ?? 0).toLocaleString()} exhausted`,
          tone: (dlqExhausted ?? 0) > 0 ? ("destructive" as Tone) : depth > 0 ? ("warning" as Tone) : ("plain" as Tone),
        }

  // Trace pipeline. A drop by policy (`errors_only`, `sampled_out`) is the
  // configuration working, not loss.
  const tq = subsystems.traces
  let lost = 0
  for (const [reason, n] of tq.dropped) if (!isPolicyDrop(reason)) lost += n
  const traceTile = !hasFigures
    ? { value: "—", sub: NO_FIGURE[state], tone: "muted" as Tone }
    : {
        value: `queue ${tq.queueDepth ?? "—"}${windowed ? ` · ${lost} dropped` : ""}`,
        sub:
          tq.workersActive != null && tq.workersTotal != null
            ? `workers ${tq.workersActive}/${tq.workersTotal}${windowed && tq.rejected ? ` · ${tq.rejected} rejected` : ""}`
            : windowed
              ? `last ${windowLabel}`
              : NO_FIGURE.warming,
        tone: lost > 0 || (tq.rejected ?? 0) > 0 ? ("warning" as Tone) : ("plain" as Tone),
      }

  // DB pool
  const pool = subsystems.dbPool
  const poolTile =
    !hasFigures || pool.size == null
      ? { value: "—", sub: hasFigures ? "not reported" : NO_FIGURE[state], tone: "muted" as Tone }
      : {
          value: `${pool.busy ?? 0}/${pool.size} busy`,
          sub: `${pool.idle ?? 0} idle`,
          tone: pool.busy != null && pool.busy >= pool.size ? ("warning" as Tone) : ("plain" as Tone),
        }

  return (
    <Card>
      <CardHeader className="flex h-[3.25rem] flex-row items-center justify-between pb-2">
        <CardTitle>Subsystems</CardTitle>
        <span className="text-xs text-muted-foreground">each one opens its own page</span>
      </CardHeader>
      <CardContent>
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-7" aria-label="Subsystems">
          <Tile name="Cron" to="/schedules" {...cron} />
          <Tile name="Response cache" to="/caches" title="Hit share over the window; cumulative until a second sample" {...cacheTile} />
          <Tile name="Rate limits" to="/system-map" {...rateTile} />
          <Tile name="Breakers" to="/circuit-breakers" {...breakerTile} />
          <Tile name="Trace DLQ" to="/trace-dlq" {...dlqTile} />
          <Tile
            name="Trace pipeline"
            to="/traces"
            title="Dropped excludes drops by policy (errors_only, sampled_out)"
            {...traceTile}
          />
          <Tile name="DB pool" to="/engine#component-database" {...poolTile} />
        </ul>
      </CardContent>
    </Card>
  )
}

function Tile({
  name,
  value,
  sub,
  tone,
  to,
  title,
}: {
  name: string
  value: string
  sub: ReactNode
  tone: Tone
  to: string
  title?: string
}) {
  return (
    <li>
      <Link
        to={to}
        title={title}
        className="flex h-full flex-col gap-0.5 rounded-lg border p-2.5 transition-colors outline-none hover:border-border-strong hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring/60"
      >
        <span className="text-xs text-muted-foreground">{name}</span>
        <span className={cn("truncate text-sm font-semibold tabular-nums", TONE[tone])}>{value}</span>
        <span className="truncate text-xs text-muted-foreground">{sub}</span>
      </Link>
    </li>
  )
}
