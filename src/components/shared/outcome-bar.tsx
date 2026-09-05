import { Sparkline } from "@/components/ui/sparkline"
import type { ChannelTraffic, TrafficSeries } from "@/hooks/use-metrics"
import { segmentColor } from "@/lib/traffic-encoding"
import { cn } from "@/lib/utils"

/**
 * The four outcome classes in bar order. One table, so the map card, the
 * inspector and the channel page cannot disagree about what a segment is or
 * what colour it takes; the rejected segment is named after the dominant
 * issue in the window when there is one (`unauthorized`, `timeout`).
 */
const SEGMENTS = [
  { key: "ok", color: segmentColor.ok, value: (t: ChannelTraffic) => t.ok, label: () => "ok" },
  { key: "failed", color: segmentColor.failed, value: (t: ChannelTraffic) => t.failed, label: () => "failed" },
  {
    key: "rejected",
    color: segmentColor.rejected,
    value: (t: ChannelTraffic) => t.rejected,
    label: (t: ChannelTraffic) => t.dominantIssue ?? "rejected",
  },
  { key: "duplicate", color: segmentColor.duplicate, value: (t: ChannelTraffic) => t.duplicate, label: () => "duplicate" },
] as const

/**
 * Proportional strip of what the channel answered inside the window. Divs
 * rather than SVG: the colours are Tailwind tokens, and a `fill` attribute
 * does not read a CSS custom property the way a `background` does.
 */
export function OutcomeBar({ traffic, className }: { traffic: ChannelTraffic; className?: string }) {
  const total = traffic.windowed
  if (total <= 0) return null
  return (
    <div className={cn("flex h-1.5 w-full overflow-hidden rounded-full bg-muted", className)}>
      {SEGMENTS.map((s) => {
        const value = s.value(traffic)
        return value > 0 ? (
          <div key={s.key} className={s.color} style={{ width: `${(value / total) * 100}%` }} />
        ) : null
      })}
    </div>
  )
}

/** The bar's key, with counts: a list by default, chips when `inline`. */
export function OutcomeLegend({
  traffic,
  inline = false,
  className,
}: {
  traffic: ChannelTraffic
  inline?: boolean
  className?: string
}) {
  const rows = SEGMENTS.map((s) => ({
    key: s.key,
    color: s.color,
    label: s.label(traffic),
    value: s.value(traffic),
  })).filter((r) => r.value > 0)
  if (inline) {
    return (
      <div className={cn("flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground", className)}>
        {rows.map((r) => (
          <span key={r.key} className="inline-flex items-center gap-1.5">
            <span className={cn("h-1.5 w-1.5 rounded-full", r.color)} />
            {r.label} <span className="font-mono tabular-nums">{r.value}</span>
          </span>
        ))}
      </div>
    )
  }
  return (
    <div className={cn("space-y-0.5 text-[11px]", className)}>
      {rows.map((r) => (
        <div key={r.key} className="flex items-center gap-1.5">
          <span className={cn("h-1.5 w-1.5 rounded-full", r.color)} />
          <span className="text-muted-foreground">{r.label}</span>
          <span className="ml-auto font-mono tabular-nums">{r.value}</span>
        </div>
      ))}
    </div>
  )
}

/** A channel's rate and error-share trends over the window, side by side. */
export function TrafficSparklines({
  series,
  height,
  compact = false,
  className,
}: {
  series: TrafficSeries
  height?: number
  /** Smaller labels, for the inspector's narrow column. */
  compact?: boolean
  className?: string
}) {
  if (series.rate.length < 2) return null
  const label = compact
    ? "text-[10px] uppercase tracking-wide text-muted-foreground"
    : "text-xs text-muted-foreground"
  return (
    <div className={cn("grid grid-cols-2", compact ? "gap-3" : "gap-4", className)}>
      <div>
        <p className={label}>rate</p>
        <Sparkline values={series.rate} height={height} className="text-chart-1" />
      </div>
      <div>
        <p className={label}>errors %</p>
        <Sparkline values={series.errorPct} height={height} className="text-destructive" />
      </div>
    </div>
  )
}
