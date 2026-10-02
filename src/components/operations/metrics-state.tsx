import { Callout } from "@/components/ui/callout"
import type { MetricsState } from "@/hooks/use-metrics"
import { formatDate, formatRelative, cn } from "@/lib/utils"

/**
 * What the page says about the metrics feed, one sentence per state.
 *
 * QA showed "metrics offline" and "Enable [metrics]…" for the ~7 s the first
 * 900 kB scrape took to answer. Loading is not off: only `off` — the server
 * answered and there is nothing to read — may tell an operator to change the
 * configuration.
 */
const METRICS_PILL: Record<MetricsState, string> = {
  loading: "loading metrics",
  warming: "first sample · rates in ~10 s",
  live: "live",
  off: "metrics off",
  error: "metrics unreachable",
}

/** The header's status line: a live dot, or the state in words. */
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
        : METRICS_PILL[state]
  const pulsing = state === "live" && !paused && !stale
  return (
    <span
      className="flex items-center gap-1.5 text-xs text-muted-foreground"
      role="status"
      title={lastUpdated != null ? `Last sample ${formatDate(lastUpdated)}` : undefined}
    >
      <span className="relative flex h-2 w-2 items-center justify-center" aria-hidden="true">
        {pulsing && (
          // The global prefers-reduced-motion rule stops this ping.
          <span className="absolute inline-flex h-2 w-2 animate-ping rounded-full bg-success/60" />
        )}
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
 * draw: `off` (configuration) and `error` (no sample at all). Loading,
 * warming and live render the tiles themselves, so this returns null for them.
 */
export function MetricsStateNotice({ state, className }: { state: MetricsState; className?: string }) {
  if (state === "off") {
    return (
      <Callout variant="muted" className={className}>
        Metrics are off on this engine. Enable <code className="font-mono">[metrics]</code> in the
        Orion configuration to see throughput, error share, latency, saturation and the per-channel
        figures. Incidents, schedules and the trace DLQ below do not depend on it.
      </Callout>
    )
  }
  if (state === "error") {
    return (
      <Callout variant="warning" className={className}>
        Metrics unreachable: the scrape of <code className="font-mono">/metrics</code> failed and no
        earlier sample is held. It is retried every 10 s. Incidents, schedules and the trace DLQ
        below do not depend on it.
      </Callout>
    )
  }
  return null
}
