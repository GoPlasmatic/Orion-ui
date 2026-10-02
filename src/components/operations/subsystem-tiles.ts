import type { CircuitBreakerStatus, CronScheduleStatus } from "@/api/types"
import type { MetricsState } from "@/hooks/use-metrics"
import { isPolicyDrop, type SubsystemMetrics } from "@/hooks/use-ops-metrics"
import { openBreakers } from "@/lib/breakers"
import { cronBacklog, isFailedOrSkipped } from "@/lib/cron"
import { METRICS_STATE_TEXT } from "@/lib/metrics-state"
import { formatPct } from "@/lib/traffic-encoding"
import { formatDate, formatRelative, plural, serverTime } from "@/lib/utils"

/**
 * What each Subsystems tile says, as pure functions of the data — so the
 * Cron tile and the incident list read one backlog verdict (`cronBacklog`),
 * and each tile's copy is testable without rendering.
 */

export type TileTone = "plain" | "warning" | "destructive" | "muted"

export interface TileModel {
  value: string
  sub: string
  tone: TileTone
  /** Hover text for the tile. */
  title?: string
}

export const tile = (value: string, sub: string, tone: TileTone = "plain", title?: string): TileModel => ({
  value,
  sub,
  tone,
  title,
})

/** A metric-backed tile with no figure to show, saying why. */
export const noFigure = (state: MetricsState): TileModel => tile("—", METRICS_STATE_TEXT[state].short, "muted")

const hasFigures = (state: MetricsState) => state === "live" || state === "warming"

export function cronTile({
  hasCron,
  cronEnabled,
  schedules,
  oldestPendingSec,
  now,
  label = (name) => name,
}: {
  hasCron: boolean
  /** `engine/status.capabilities.cron`; undefined from a pre-1.9 server. */
  cronEnabled: boolean | undefined
  schedules: CronScheduleStatus[] | undefined
  /** `/health`'s `cron.oldest_pending_age_secs`. */
  oldestPendingSec: number | null | undefined
  now: number
  label?: (name: string) => string
}): TileModel {
  if (!hasCron || cronEnabled === false) return tile("off", "no scheduler on this node", "muted")
  if (!schedules) return tile("…", "reading schedules", "muted")
  if (schedules.length === 0) return tile("none active", "no cron channel", "muted")
  const pending = schedules.reduce((n, s) => n + (s.pending ?? 0), 0)
  const verdict = cronBacklog(pending, oldestPendingSec)
  const late = schedules.filter((s) => isFailedOrSkipped(s.last_status))
  const next = schedules
    .map((s) => ({ s, at: serverTime(s.next_fire_at) }))
    .filter((x): x is { s: CronScheduleStatus; at: number } => x.at != null && x.at >= now - 5_000)
    .sort((a, b) => a.at - b.at)[0]
  const value = `${schedules.length - late.length} on time · ${pending} ${verdict === "backlog" ? "backlog" : "queued"}`
  const sub = next ? `next: ${label(next.s.channel_name)} ${formatRelative(next.at, now)}` : "nothing scheduled"
  const title = [
    late.length ? `Last run did not complete: ${late.map((s) => s.channel_name).join(", ")}` : null,
    next ? `Next run ${formatDate(next.at)}` : null,
  ]
    .filter(Boolean)
    .join(" · ")
  return tile(value, sub, late.length > 0 || verdict === "backlog" ? "warning" : "plain", title || undefined)
}

export function cacheTile(cache: SubsystemMetrics["cache"], state: MetricsState, windowed: boolean): TileModel {
  if (!hasFigures(state)) return noFigure(state)
  if (!cache.seen) return tile("no cached channels", "no channel has looked up the cache", "muted")
  const coalesced = windowed && cache.coalesced ? ` · ${cache.coalesced} coalesced` : ""
  return tile(
    cache.hitPct == null ? "—" : `hit ${formatPct(cache.hitPct)}`,
    `${plural(cache.byChannel.size, "channel")}${coalesced}`,
    "plain",
    "Hit share over the window; cumulative until a second sample",
  )
}

export function rateLimitTile(rl: SubsystemMetrics["rateLimit"], state: MetricsState, windowLabel: string): TileModel {
  if (state !== "live") return noFigure(state)
  const top = [...rl.byScope.entries()].sort((a, b) => b[1] - a[1])[0]
  const n = rl.rejections ?? 0
  return tile(
    `${n.toLocaleString("en")} rejected`,
    top ? `mostly ${top[0]} · last ${windowLabel}` : `last ${windowLabel}`,
    n > 0 ? "warning" : "plain",
  )
}

export function breakerTile(
  breakers: CircuitBreakerStatus | undefined,
  trips: number | null,
  windowed: boolean,
): TileModel {
  if (!breakers) return tile("…", "reading this node's map", "muted")
  if (!breakers.enabled) return tile("disabled", "on this engine", "muted")
  const open = openBreakers(breakers).length
  const tracked = Object.keys(breakers.breakers ?? {}).length
  const tripText = windowed && trips ? ` · ${plural(trips, "trip")}` : ""
  return tile(open > 0 ? `${open} open` : "all closed", `${tracked} tracked${tripText} · this node`, open > 0 ? "warning" : "plain")
}

/** The DLQ list's own count first; the gauge stands in while it loads. */
export function dlqTile(depth: number | null, exhausted: number | null): TileModel {
  if (depth == null) return tile("…", "reading the queue", "muted")
  const ex = exhausted ?? 0
  return tile(
    depth === 0 ? "empty" : `${depth.toLocaleString("en")} waiting`,
    `${ex.toLocaleString("en")} exhausted`,
    ex > 0 ? "destructive" : depth > 0 ? "warning" : "plain",
  )
}

/** Drops by policy (`errors_only`, `sampled_out`) are the configuration working, not loss. */
export function tracePipelineTile(tq: SubsystemMetrics["traces"], state: MetricsState, windowLabel: string): TileModel {
  if (!hasFigures(state)) return noFigure(state)
  const windowed = state === "live"
  let lost = 0
  for (const [reason, n] of tq.dropped) if (!isPolicyDrop(reason)) lost += n
  const rejected = windowed && tq.rejected ? ` · ${tq.rejected} rejected` : ""
  const sub =
    tq.workersActive != null && tq.workersTotal != null
      ? `workers ${tq.workersActive}/${tq.workersTotal}${rejected}`
      : windowed
        ? `last ${windowLabel}`
        : METRICS_STATE_TEXT.warming.short
  return tile(
    `queue ${tq.queueDepth ?? "—"}${windowed ? ` · ${lost} dropped` : ""}`,
    sub,
    lost > 0 || (tq.rejected ?? 0) > 0 ? "warning" : "plain",
    "Dropped excludes drops by policy (errors_only, sampled_out)",
  )
}

export function dbPoolTile(pool: SubsystemMetrics["dbPool"], state: MetricsState): TileModel {
  if (!hasFigures(state)) return noFigure(state)
  if (pool.size == null) return tile("—", "not reported", "muted")
  const busy = pool.busy ?? 0
  return tile(`${busy}/${pool.size} busy`, `${pool.idle ?? 0} idle`, busy >= pool.size ? "warning" : "plain")
}
