import type { ChannelTraffic } from "@/hooks/use-metrics"
import type { SystemGraph, SystemNode } from "@/lib/system-graph"

/**
 * How live telemetry becomes shape and colour on the System Map.
 *
 * Kept out of the components so the thresholds are in one place and the
 * distinctions below survive contact with the rendering code.
 */

/**
 * A level is a colour slot, ordered from quiet to loud; what it *means* depends
 * on the colour metric, and `legendFor` is what names it.
 *
 * `notice` is the informational blue, and it exists because rejected traffic
 * is deliberately not a kind of failure. Orion 1.2 reports `unauthorized` on
 * `orion_messages_total{status}`, and it is refused at the edge — no workflow
 * runs, nothing goes wrong. A channel serving nothing but 401s is either
 * working exactly as designed (an authenticated route being probed) or badly
 * misconfigured, and the map cannot tell which. Painting it red claims a
 * failure that did not happen; folding it into "healthy" hides a channel that
 * is serving no real traffic. So it gets its own colour, and the legend says
 * "rejected". The same slot is "100–500 ms" in latency mode and "draft" in
 * lifecycle mode — a middle band that is neither good news nor bad.
 */
export type HealthLevel = "idle" | "healthy" | "notice" | "warning" | "critical"

/** Failure share above which a channel reads as broken rather than flaky. */
const CRITICAL_ERROR_PCT = 5
const WARNING_ERROR_PCT = 1
/** Rejection share above which "guarded" is the honest summary of the channel. */
const REJECTED_PCT = 50

/**
 * The error-share bands, on their own, so the dashboard's KPI strip and the
 * map agree on what "failing" means. Null is "nothing processed", which is
 * idle rather than healthy.
 */
export function errorLevel(errorPct: number | null | undefined): HealthLevel {
  if (errorPct == null) return "idle"
  if (errorPct >= CRITICAL_ERROR_PCT) return "critical"
  if (errorPct >= WARNING_ERROR_PCT) return "warning"
  return "healthy"
}

export function healthOf(traffic: ChannelTraffic | undefined): HealthLevel {
  if (!traffic || traffic.windowed === 0) return "idle"
  const byErrors = errorLevel(traffic.errorPct)
  if (byErrors === "critical" || byErrors === "warning") return byErrors
  if (traffic.rejectedPct != null && traffic.rejectedPct >= REJECTED_PCT) return "notice"
  return "healthy"
}

/** Latency bands, in ms, for the latency colour mode. */
const LATENCY_GOOD = 100
const LATENCY_OK = 500
const LATENCY_SLOW = 2000

export function latencyLevel(p95Ms: number | null | undefined): HealthLevel {
  if (p95Ms == null) return "idle"
  if (p95Ms >= LATENCY_SLOW) return "critical"
  if (p95Ms >= LATENCY_OK) return "warning"
  if (p95Ms >= LATENCY_GOOD) return "notice"
  return "healthy"
}

/**
 * Fill, ring and text for each level. Semantic ink tokens, never chart tokens:
 * every one of these sits next to a label.
 */
export const healthDot: Record<HealthLevel, string> = {
  idle: "bg-muted-foreground/30",
  healthy: "bg-success",
  warning: "bg-warning",
  critical: "bg-destructive",
  notice: "bg-info",
}

export const healthRing: Record<HealthLevel, string> = {
  idle: "ring-border",
  healthy: "ring-success/30",
  warning: "ring-warning/40",
  critical: "ring-destructive/50",
  notice: "ring-info/40",
}

export const healthText: Record<HealthLevel, string> = {
  idle: "text-muted-foreground",
  healthy: "text-success",
  warning: "text-warning",
  critical: "text-destructive",
  notice: "text-info",
}

/** Health-mode names for the slots; `legendFor` is the metric-aware reading. */
export const healthLabel: Record<HealthLevel, string> = {
  idle: "no traffic",
  healthy: "healthy",
  notice: "rejected",
  warning: "errors",
  critical: "failing",
}

/** Stacked-bar segment colours, in the order they are drawn. */
export const segmentColor = {
  ok: "bg-success",
  failed: "bg-destructive",
  rejected: "bg-info",
  duplicate: "bg-muted-foreground/40",
} as const


/**
 * Load for channels the exporter never sees.
 *
 * `orion_messages_total{channel}` counts *ingress*. A channel reached only by
 * `channel_call` — every `internal-*` route here — is dispatched inside the
 * engine and never appears in the series at all, nor in
 * `orion_workflow_duration_seconds`. Drawn naively that makes the busiest
 * dependency in the system, the one two dozen channels call on every request,
 * render as permanently idle: the single most misleading thing this map could
 * say.
 *
 * So load propagates. A channel with no series of its own inherits an upper
 * bound from the callers that reach it, walked in tier order so a caller is
 * always resolved before its callees — including through chains of internal
 * channels. It is an upper bound, not a measurement: one call per run is the
 * common case, a loop or an untaken branch makes it an over-estimate, and the
 * UI labels it `≤` rather than pretending otherwise.
 */
export interface EffectiveLoad {
  /** Measured requests per minute at the edge. Null when never metered. */
  own: number | null
  /** Upper bound propagated from callers, for an unmetered channel. */
  derived: number | null
  /** True when the exporter carries a series for this channel. */
  metered: boolean
  /** What the map draws: measured where it exists, derived where it does not. */
  effective: number | null
}

export function deriveLoad(
  graph: SystemGraph,
  byChannel: Map<string, ChannelTraffic>,
): Map<string, EffectiveLoad> {
  const out = new Map<string, EffectiveLoad>()
  // Tier order guarantees callers resolve first; cycle members were parked past
  // the acyclic part and simply read whatever their callers already have.
  const ordered = [...graph.nodes].sort((a, b) => a.tier - b.tier)

  for (const node of ordered) {
    const traffic = byChannel.get(node.id)
    const metered = traffic != null
    const own = traffic?.ratePerMin ?? null

    if (metered) {
      out.set(node.id, { own, derived: null, metered: true, effective: own })
      continue
    }

    let derived = 0
    let sawAny = false
    for (const caller of node.callers) {
      const upstream = out.get(caller)
      if (upstream?.effective != null) {
        derived += upstream.effective
        sawAny = true
      }
    }
    out.set(node.id, {
      own: null,
      derived: sawAny ? derived : null,
      metered: false,
      effective: sawAny ? derived : null,
    })
  }

  return out
}

export type SizeMetric = "rate" | "latency" | "steps" | "uniform"
export type ColorMetric = "health" | "latency" | "lifecycle"

export const SIZE_METRICS: { value: SizeMetric; label: string }[] = [
  { value: "rate", label: "Requests / min" },
  { value: "latency", label: "p95 latency" },
  { value: "steps", label: "Workflow steps" },
  { value: "uniform", label: "Uniform" },
]

export const COLOR_METRICS: { value: ColorMetric; label: string }[] = [
  { value: "health", label: "Health" },
  { value: "latency", label: "Latency" },
  { value: "lifecycle", label: "Lifecycle" },
]

export interface LegendEntry {
  level: HealthLevel
  label: string
}

/**
 * What each colour means under the current colour metric, in the order the
 * legend draws them. The legend used to be hard-wired to the health labels, so
 * "Colour: Latency" painted a slow channel amber and captioned it "errors",
 * and "Colour: Lifecycle" painted a draft blue and captioned it "rejected".
 */
export function legendFor(metric: ColorMetric): LegendEntry[] {
  switch (metric) {
    case "latency":
      return [
        { level: "healthy", label: `p95 < ${LATENCY_GOOD} ms` },
        { level: "notice", label: `${LATENCY_GOOD}–${LATENCY_OK} ms` },
        { level: "warning", label: `${LATENCY_OK} ms – ${LATENCY_SLOW / 1000} s` },
        { level: "critical", label: `≥ ${LATENCY_SLOW / 1000} s` },
        { level: "idle", label: "no traffic" },
      ]
    case "lifecycle":
      return [
        { level: "healthy", label: "active" },
        { level: "notice", label: "draft" },
        { level: "idle", label: "archived" },
        { level: "critical", label: "named by a call, not registered" },
      ]
    default:
      return [
        { level: "healthy", label: "healthy" },
        { level: "warning", label: `errors ≥ ${WARNING_ERROR_PCT}%` },
        { level: "critical", label: `failing ≥ ${CRITICAL_ERROR_PCT}%` },
        { level: "notice", label: `rejected ≥ ${REJECTED_PCT}%` },
        { level: "idle", label: "no traffic" },
      ]
  }
}

const MIN_DOT = 10
const MAX_DOT = 40

export function rawSize(
  metric: SizeMetric,
  node: SystemNode,
  traffic: ChannelTraffic | undefined,
  load?: EffectiveLoad,
): number {
  switch (metric) {
    case "rate":
      // Derived load counts towards size: a hub drawn small because the
      // exporter cannot see it is the failure mode deriveLoad exists to avoid.
      return load?.effective ?? traffic?.ratePerMin ?? traffic?.windowed ?? 0
    case "latency":
      return traffic?.p95Ms ?? 0
    case "steps":
      return node.steps
    case "uniform":
      return 1
  }
}

/**
 * Square-root scaling, because the dot reads as an *area*: a channel with 100×
 * the traffic drawn at 100× the diameter is 10,000× the ink and swallows the
 * canvas. On this system the spread is real — one hub carries two orders of
 * magnitude more than a leaf.
 */
export function dotSize(value: number, max: number): number {
  if (max <= 0 || value <= 0) return MIN_DOT
  const scaled = Math.sqrt(value / max)
  return Math.round(MIN_DOT + (MAX_DOT - MIN_DOT) * scaled)
}

export function levelFor(
  metric: ColorMetric,
  node: SystemNode,
  traffic: ChannelTraffic | undefined,
): HealthLevel {
  if (metric === "latency") return latencyLevel(traffic?.p95Ms)
  if (metric === "lifecycle") {
    if (node.unresolved) return "critical"
    return node.status === "active" ? "healthy" : node.status === "draft" ? "notice" : "idle"
  }
  return healthOf(traffic)
}

/** Compact number for a node label: 1.2k, 340, 8.5 */
export function compactNumber(value: number | null | undefined): string {
  if (value == null) return "—"
  if (value >= 10_000) return `${Math.round(value / 1000)}k`
  if (value >= 1000) return `${(value / 1000).toFixed(1)}k`
  if (value >= 100) return String(Math.round(value))
  if (value >= 10) return value.toFixed(0)
  if (value === 0) return "0"
  return value.toFixed(1)
}

export function formatMs(ms: number | null | undefined): string {
  if (ms == null) return "—"
  if (ms >= 1000) return `${(ms / 1000).toFixed(2)}s`
  if (ms >= 10) return `${Math.round(ms)}ms`
  return `${ms.toFixed(1)}ms`
}

export function formatPct(pct: number | null | undefined): string {
  if (pct == null) return "—"
  if (pct === 0) return "0%"
  if (pct < 0.1) return "<0.1%"
  if (pct < 10) return `${pct.toFixed(1)}%`
  return `${Math.round(pct)}%`
}

/**
 * Edge weight is *derived*, and this is the one place that says so.
 *
 * `orion_messages_total{channel}` counts what arrived at a channel; nothing
 * attributes those arrivals to a particular caller. So the traffic on a
 * `channel_call` edge is not measured — it is bounded by the caller's own rate,
 * which is what gets drawn. It is right for the common case (one call per run)
 * and an over-estimate inside a loop or a false branch. The map says "up to",
 * never "exactly".
 */
export function edgeWeight(sourceRate: number | null, maxRate: number): number {
  if (!sourceRate || sourceRate <= 0 || maxRate <= 0) return 1
  return 1 + Math.sqrt(sourceRate / maxRate) * 4
}
