import type { MetricsState } from "@/hooks/use-metrics"
import { METRICS_STATE_TEXT, metricsShort } from "@/lib/metrics-state"
import { healthDot, trafficLine, type HealthLevel } from "@/lib/traffic-encoding"
import { cn, plural } from "@/lib/utils"

/**
 * One row's live traffic in a list cell: a health dot and the shared
 * `trafficLine` (rate · error share · p95), or why there is nothing to show —
 * `idle` (no requests in the window), or the feed's own state in the words
 * every page uses (`METRICS_STATE_TEXT`). Shared by the channel and connector
 * lists so the two read the same.
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
  if (state === "off" || state === "error" || state === "loading") {
    return (
      <span className="text-xs text-muted-foreground" title={METRICS_STATE_TEXT[state].sentence}>
        {state === "loading" ? "…" : "—"}
      </span>
    )
  }
  if (!windowed) {
    const warming = state === "warming"
    return (
      <span
        className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"
        title={warming ? METRICS_STATE_TEXT.warming.sentence : `No requests ${spanLabel ?? "in the window"}`}
      >
        <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", healthDot.idle)} />
        {warming ? metricsShort("warming") : "idle"}
      </span>
    )
  }
  const line = trafficLine({ ratePerMin, errorPct, p95Ms })
  return (
    <span
      className="inline-flex items-center gap-1.5 whitespace-nowrap font-mono text-xs tabular-nums"
      title={`${plural(windowed, "request")} ${spanLabel ?? ""} · ${line}`}
    >
      <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", healthDot[level])} />
      {line}
    </span>
  )
}
