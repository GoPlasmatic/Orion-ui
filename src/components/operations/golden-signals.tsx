import { KpiCard } from "@/components/shared/kpi-card"
import { MetricsStateNotice } from "@/components/operations/metrics-state"
import type { TrafficWindow } from "@/hooks/use-metrics"
import type { SubsystemMetrics } from "@/hooks/use-ops-metrics"
import { errorLevel, healthText, latencyLevel } from "@/lib/traffic-encoding"
import { formatDuration, formatSpan } from "@/lib/utils"

/** Said in place of a rate while only one sample exists. */
const WARMING_HINT = "rates after the next sample (~10 s)"

/**
 * The four golden signals over the chosen window: throughput, error share,
 * p95 latency and saturation. Each state of the metrics feed is rendered for
 * what it is — skeletons while the first scrape loads, real totals while one
 * sample is held, windowed figures once two are, and a callout (never empty
 * tiles) when the feed is off or unreachable.
 */
export function GoldenSignals({
  traffic,
  subsystems,
  windowLabel,
  label = (name) => name,
}: {
  traffic: TrafficWindow
  subsystems: SubsystemMetrics
  windowLabel: string
  /** A channel's display name (the domain-short form on a large system). */
  label?: (name: string) => string
}) {
  const state = traffic.state
  if (state === "off" || state === "error") return <MetricsStateNotice state={state} />

  const loading = state === "loading"
  const live = state === "live"
  const basis = live ? `last ${formatSpan(traffic.spanSec)}` : "since the engine started"

  // Throughput
  const total = traffic.channels.reduce((n, c) => n + c.total, 0)
  const throughput = live
    ? {
        value: traffic.totalRatePerMin == null ? "—" : Math.round(traffic.totalRatePerMin).toLocaleString(),
        unit: "/min",
        hint: `${traffic.windowed.toLocaleString()} requests · ${basis}`,
      }
    : {
        value: total.toLocaleString(),
        unit: "total",
        hint: WARMING_HINT,
      }

  // Error share, with what was refused at the edge and what timed out apart:
  // a 401 is not a failure, and a timeout is a different fix from an error.
  let rejected = 0
  let unauthorized = 0
  let timeouts = 0
  for (const c of traffic.channels) {
    rejected += c.rejected
    unauthorized += c.byStatus.unauthorized ?? 0
    timeouts += c.byStatus.timeout ?? 0
  }
  const rejectedText =
    rejected > 0 && unauthorized === rejected
      ? `${rejected.toLocaleString()} rejected (401)`
      : `${rejected.toLocaleString()} rejected`
  const errLevel = errorLevel(traffic.errorPct)

  // p95, naming the slowest channel that carried traffic.
  const slowest = traffic.channels
    .filter((c) => c.windowed > 0 && c.p95Ms != null)
    .sort((a, b) => (b.p95Ms ?? 0) - (a.p95Ms ?? 0))[0]
  const latLevel = latencyLevel(traffic.p95Ms)

  // Saturation: the DB pool's busy connections over its size, and the trace
  // queue that absorbs a write backlog.
  const pool = subsystems.dbPool
  const tq = subsystems.traces
  const workers =
    tq.workersActive != null && tq.workersTotal != null ? ` · workers ${tq.workersActive}/${tq.workersTotal}` : ""
  const poolBusyPct = pool.busy != null && pool.size ? (pool.busy / pool.size) * 100 : null

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4" aria-label={`Golden signals, ${basis}`}>
      <KpiCard
        title="Throughput"
        loading={loading}
        value={throughput.value}
        unit={throughput.unit}
        hint={throughput.hint}
        series={live ? traffic.series.rate : undefined}
        colorClass="text-chart-1"
        to="/system-map"
      />
      <KpiCard
        title="Error share"
        loading={loading}
        value={traffic.errorPct == null ? "—" : traffic.errorPct.toFixed(1)}
        unit={traffic.errorPct == null ? undefined : "%"}
        hint={
          traffic.errorPct == null
            ? `nothing processed · ${basis}`
            : `${rejectedText} · ${timeouts.toLocaleString()} timeout${timeouts === 1 ? "" : "s"}${live ? "" : ` · ${basis}`}`
        }
        hintTitle={`Failures over processed requests (${basis}). Rejected requests were refused at the edge and never ran; duplicates are excluded.`}
        series={live ? traffic.series.errorPct : undefined}
        // The sparkline is chart geometry (chart-*); the numeral takes the ink
        // once it crosses the bands the map paints.
        colorClass="text-chart-4"
        valueClass={errLevel === "warning" || errLevel === "critical" ? healthText[errLevel] : undefined}
        to="/traces?status=failed"
      />
      <KpiCard
        title="p95 latency"
        loading={loading}
        value={traffic.p95Ms == null ? "—" : formatDuration(traffic.p95Ms)}
        hint={
          slowest
            ? `slowest: ${label(slowest.channel)} ${formatDuration(slowest.p95Ms)}`
            : live
              ? basis
              : `${basis} · ${WARMING_HINT}`
        }
        hintTitle={slowest ? `${slowest.channel} · p95 ${basis}` : undefined}
        series={live ? traffic.series.meanMs : undefined}
        colorClass="text-chart-3"
        valueClass={latLevel === "warning" || latLevel === "critical" ? healthText[latLevel] : undefined}
        to="/system-map?colour=latency"
      />
      <KpiCard
        title="Saturation"
        loading={loading}
        value={pool.busy != null && pool.size != null ? `${pool.busy} / ${pool.size}` : "—"}
        hint={`DB pool busy · trace queue ${tq.queueDepth == null ? "—" : tq.queueDepth.toLocaleString()}${workers}`}
        hintTitle="Connections in use over the pool size (orion_db_pool_*), and the trace write queue (orion_trace_queue_depth)"
        meter={
          pool.busy != null && pool.size
            ? { value: pool.busy, max: pool.size, label: `${pool.busy} of ${pool.size} pool connections busy` }
            : undefined
        }
        colorClass="text-chart-2"
        valueClass={poolBusyPct != null && poolBusyPct >= 90 ? "text-warning" : undefined}
        to="/engine#component-database"
      />
      {/* Window label for assistive tech: the tiles all cover the same span. */}
      <span className="sr-only">Every figure covers the {live ? `last ${windowLabel}` : "time since the engine started"}.</span>
    </div>
  )
}
