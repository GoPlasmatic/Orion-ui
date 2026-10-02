import type { MetricsState } from "@/hooks/use-metrics"
import { compactNumber, formatMs, formatPct, healthDot, type HealthLevel } from "@/lib/traffic-encoding"
import { cn } from "@/lib/utils"

/**
 * One row's live traffic in a list cell: a health dot, the rate, the error
 * share and p95, or why there is nothing to show — `idle` (no requests in the
 * window), a warming feed, or metrics that are off. Shared by the channel and
 * connector lists so the two read the same.
 */
export function TrafficCell({
  state,
  level,
  ratePerMin,
  errorPct,
  p95Ms,
  windowed,
  spanLabel,
}: {
  state: MetricsState
  level: HealthLevel
  ratePerMin: number | null | undefined
  errorPct: number | null | undefined
  p95Ms: number | null | undefined
  /** Requests inside the window; 0 or absent reads as idle. */
  windowed: number | null | undefined
  spanLabel?: string
}) {
  if (state === "off" || state === "error") {
    return (
      <span className="text-muted-foreground" title={state === "off" ? "Metrics are off on this server" : "The metrics scrape failed"}>
        —
      </span>
    )
  }
  if (state === "loading") return <span className="text-xs text-muted-foreground">…</span>
  if (!windowed) {
    return (
      <span
        className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"
        title={state === "warming" ? "Waiting for a second sample" : `No requests ${spanLabel ?? "in the window"}`}
      >
        <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", healthDot.idle)} />
        {state === "warming" ? "warming" : "idle"}
      </span>
    )
  }
  return (
    <span
      className="inline-flex items-center gap-1.5 whitespace-nowrap font-mono text-xs tabular-nums"
      title={`${windowed.toLocaleString()} requests ${spanLabel ?? ""} · ${formatPct(errorPct)} errors · p95 ${formatMs(p95Ms)}`}
    >
      <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", healthDot[level])} />
      <span>{compactNumber(ratePerMin)}/min</span>
      <span className="text-muted-foreground">·</span>
      <span>{formatPct(errorPct)}</span>
      <span className="text-muted-foreground">·</span>
      <span>{formatMs(p95Ms)}</span>
    </span>
  )
}
