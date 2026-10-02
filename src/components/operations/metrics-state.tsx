import { Callout } from "@/components/ui/callout"
import type { MetricsState } from "@/hooks/use-metrics"
import { METRICS_STATE_TEXT } from "@/lib/metrics-state"
import { formatDate, formatRelative, cn } from "@/lib/utils"

/** The header's status line: a live dot, or the state in the shared words. */
export function MetricsStatePill({
  state,
  lastUpdated,
  now,
  paused,
  stale,
}: {
  state: MetricsState
  lastUpdated: number | null
  now: number
  paused: boolean
  /** The newest scrape failed; the sample shown is the last good one. */
  stale: boolean
}) {
  const updated = lastUpdated != null ? (formatRelative(lastUpdated, now) ?? "just now") : null
  const text = paused
    ? `paused${lastUpdated != null ? ` · sample from ${formatDate(lastUpdated)}` : ""}`
    : stale && updated
      ? `last scrape failed · showing ${updated}`
      : state === "live" && updated
        ? `live · updated ${updated}`
        : METRICS_STATE_TEXT[state].short
  const pulsing = state === "live" && !paused && !stale
  return (
    <span
      className="flex items-center gap-1.5 text-xs text-muted-foreground"
      role="status"
      title={lastUpdated != null ? `Last sample ${formatDate(lastUpdated)}` : undefined}
    >
      <span className="relative flex h-2 w-2 items-center justify-center" aria-hidden="true">
        {/* The global prefers-reduced-motion rule stops this ping. */}
        {pulsing && <span className="absolute inline-flex h-2 w-2 animate-ping rounded-full bg-success/60" />}
        <span
          className={cn(
            "relative inline-flex h-1.5 w-1.5 rounded-full",
            paused
              ? "bg-muted-foreground"
              : stale || state === "error"
                ? "bg-warning"
                : state === "live"
                  ? "bg-success"
                  : state === "off"
                    ? "bg-muted-foreground/50"
                    : "bg-info",
          )}
        />
      </span>
      {text}
    </span>
  )
}

/**
 * The callout that stands in for the golden signals when there is nothing to
 * draw (`off`, or `error` with no sample). Other states render the tiles.
 */
export function MetricsStateNotice({ state, className }: { state: MetricsState; className?: string }) {
  if (state !== "off" && state !== "error") return null
  const { sentence, tone } = METRICS_STATE_TEXT[state]
  return (
    <Callout variant={tone === "muted" ? "muted" : tone} className={className}>
      {sentence} Incidents, schedules and the trace DLQ below do not depend on it.
    </Callout>
  )
}
