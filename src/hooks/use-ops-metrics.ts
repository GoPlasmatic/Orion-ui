import { useMemo } from "react"
import { ApiError } from "@/api/client"
import {
  counterTotal,
  histogramMean,
  histogramQuantile,
  labelValues,
  sumByLabel,
  type MetricsSnapshot,
} from "@/api/metrics"
import {
  deltaSnapshot,
  metricsState,
  useMetricsSnapshot,
  windowBase,
  type MetricsState,
} from "@/hooks/use-metrics"

/**
 * Readers for the metric families the console did not read before the 1.12
 * revamp: connectors per channel, per-task cost, and the subsystems an
 * operations view needs (response cache, rate limits, DB pool, trace
 * pipeline, breakers). All of them reduce the one shared `["metrics"]` poll.
 *
 * "Windowed" figures are deltas between the newest sample and the oldest one
 * inside the window (`windowBase`), so they are null until a second sample
 * exists; cumulative ones are since the server started. Gauges are read off
 * the current sample. Every reader also reports the feed's `state`, so a page
 * can tell "not loaded yet" from "metrics are off".
 */

const CONNECTOR_REQUESTS = "orion_connector_requests_total"
const CONNECTOR_DURATION = "orion_connector_request_duration_seconds"
const TASK_DURATION = "orion_task_duration_seconds"
const WORKFLOW_DURATION = "orion_workflow_duration_seconds"

function useWindowed(windowSec: number, paused = false) {
  const query = useMetricsSnapshot(paused)
  const cur = query.data ?? null
  const errorStatus = query.error instanceof ApiError ? query.error.status : null
  const base = cur ? windowBase(cur, windowSec) : null
  const state = metricsState(
    { available: !!cur && cur.lines.length > 0, hasRate: !!base },
    query.isLoading,
    query.isError,
    errorStatus,
  )
  return { cur, base, state }
}

/** `cur − base` for one counter, or null without a base. Restarts clamp to 0. */
function windowedCount(
  cur: MetricsSnapshot,
  base: MetricsSnapshot | null,
  name: string,
  filter?: Record<string, string>,
): number | null {
  if (!base) return null
  return Math.max(0, counterTotal(cur, name, filter) - counterTotal(base, name, filter))
}

function gauge(cur: MetricsSnapshot | null, name: string): number | null {
  if (!cur) return null
  let found = false
  let sum = 0
  for (const l of cur.lines) {
    if (l.name !== name) continue
    found = true
    sum += l.value
  }
  return found ? sum : null
}

const ms = (sec: number | null) => (sec == null ? null : sec * 1000)

// ---------------------------------------------------------------------------
// Connectors
// ---------------------------------------------------------------------------

export interface ConnectorChannelTraffic {
  channel: string
  /** Calls since the server started. */
  total: number
  /** Calls inside the window; null until a second sample. */
  windowed: number | null
  errors: number | null
}

export interface ConnectorTraffic {
  connector: string
  total: number
  totalErrors: number
  windowed: number | null
  errors: number | null
  ratePerMin: number | null
  /** errors / windowed, or cumulative before a second sample. Null with no calls. */
  errorPct: number | null
  p95Ms: number | null
  meanMs: number | null
  /** Channels that called it, busiest first (cumulative). */
  channels: ConnectorChannelTraffic[]
}

export interface ConnectorTrafficWindow {
  state: MetricsState
  spanSec: number
  byConnector: Map<string, ConnectorTraffic>
  /** `${channel}|${connector}` → traffic, for an edge between the two. */
  byEdge: Map<string, ConnectorChannelTraffic>
}

export const edgeKey = (channel: string, connector: string) => `${channel}|${connector}`

/**
 * Outbound connector calls by connector and by calling channel. The label
 * pair `{connector, channel}` is what makes a *measured* channel → connector
 * edge possible: on QA, where no channel calls another, it is the only
 * structure the System Map has to draw. `status` is `ok` or `error`.
 */
export function useConnectorTraffic(windowSec: number, paused = false): ConnectorTrafficWindow {
  const { cur, base, state } = useWindowed(windowSec, paused)
  return useMemo(() => {
    const byConnector = new Map<string, ConnectorTraffic>()
    const byEdge = new Map<string, ConnectorChannelTraffic>()
    if (!cur) return { state, spanSec: 0, byConnector, byEdge }
    const spanSec = base ? (cur.t - base.t) / 1000 : 0
    const delta = base ? deltaSnapshot(base, cur) : null
    const quantileSource = delta ?? cur

    const edges = new Map<string, { connector: string; channel: string; total: number; errors: number; wTotal: number; wErrors: number }>()
    const tally = (snap: MetricsSnapshot, windowed: boolean) => {
      for (const l of snap.lines) {
        if (l.name !== CONNECTOR_REQUESTS) continue
        const connector = l.labels.connector ?? ""
        const channel = l.labels.channel ?? ""
        const k = edgeKey(channel, connector)
        const e = edges.get(k) ?? { connector, channel, total: 0, errors: 0, wTotal: 0, wErrors: 0 }
        const isErr = (l.labels.status ?? "ok") !== "ok"
        if (windowed) {
          e.wTotal += l.value
          if (isErr) e.wErrors += l.value
        } else {
          e.total += l.value
          if (isErr) e.errors += l.value
        }
        edges.set(k, e)
      }
    }
    tally(cur, false)
    if (delta) tally(delta, true)

    for (const [k, e] of edges) {
      const edge: ConnectorChannelTraffic = {
        channel: e.channel,
        total: e.total,
        windowed: delta ? e.wTotal : null,
        errors: delta ? e.wErrors : null,
      }
      byEdge.set(k, edge)
      const c =
        byConnector.get(e.connector) ??
        ({
          connector: e.connector,
          total: 0,
          totalErrors: 0,
          windowed: delta ? 0 : null,
          errors: delta ? 0 : null,
          ratePerMin: null,
          errorPct: null,
          p95Ms: null,
          meanMs: null,
          channels: [],
        } satisfies ConnectorTraffic)
      c.total += e.total
      c.totalErrors += e.errors
      if (delta) {
        c.windowed = (c.windowed ?? 0) + e.wTotal
        c.errors = (c.errors ?? 0) + e.wErrors
      }
      c.channels.push(edge)
      byConnector.set(e.connector, c)
    }
    for (const c of byConnector.values()) {
      c.channels.sort((a, b) => b.total - a.total || a.channel.localeCompare(b.channel))
      c.ratePerMin = c.windowed != null && spanSec > 0 ? (c.windowed / spanSec) * 60 : null
      const n = c.windowed != null && c.windowed > 0 ? c.windowed : c.total
      const errs = c.windowed != null && c.windowed > 0 ? (c.errors ?? 0) : c.totalErrors
      c.errorPct = n > 0 ? (errs / n) * 100 : null
      c.p95Ms = ms(histogramQuantile(quantileSource, CONNECTOR_DURATION, 0.95, { connector: c.connector }))
      c.meanMs = ms(histogramMean(base, cur, CONNECTOR_DURATION, { connector: c.connector }))
    }
    return { state, spanSec, byConnector, byEdge }
  }, [cur, base, state])
}

// ---------------------------------------------------------------------------
// Per-task cost
// ---------------------------------------------------------------------------

export interface TaskCost {
  task: string
  function: string
  /** Times this task ran since the server started — a loop body runs per iteration. */
  runs: number
  meanMs: number | null
  p95Ms: number | null
}

export interface WorkflowCost {
  state: MetricsState
  workflow: string
  /** Whole runs since the server started. */
  runs: number
  meanMs: number | null
  p95Ms: number | null
  /** Keyed by task id. */
  tasks: Map<string, TaskCost>
  /** Mean per-run time inside task bodies: each task's mean × runs-per-run. */
  taskMsPerRun: number | null
  /** Mean run minus its task bodies — conditions, loop bookkeeping, audit. */
  overheadMs: number | null
}

/**
 * Where one workflow's time goes, since the server started:
 * `orion_workflow_duration_seconds{workflow}` for a whole run and
 * `orion_task_duration_seconds{workflow,task,function}` for each task body.
 * Cumulative on purpose — a per-task baseline ("what is normal for this
 * step") wants every run there is, not the last five minutes.
 *
 * A task's share of a run weights its mean by how often it runs per run: on
 * QA's "Clock: pair" the loop body ran 185 times over 235 runs, so `insert`
 * costs 18.7 ms × 0.79 per run, not 18.7 ms.
 */
export function useWorkflowCost(workflowId: string | null | undefined): WorkflowCost {
  const query = useMetricsSnapshot()
  const cur = query.data ?? null
  const errorStatus = query.error instanceof ApiError ? query.error.status : null
  const state = metricsState(
    { available: !!cur && cur.lines.length > 0, hasRate: true },
    query.isLoading,
    query.isError,
    errorStatus,
  )
  return useMemo(() => {
    const tasks = new Map<string, TaskCost>()
    const empty: WorkflowCost = {
      state,
      workflow: workflowId ?? "",
      runs: 0,
      meanMs: null,
      p95Ms: null,
      tasks,
      taskMsPerRun: null,
      overheadMs: null,
    }
    if (!cur || !workflowId) return empty
    const filter = { workflow: workflowId }
    const runs = counterTotal(cur, `${WORKFLOW_DURATION}_count`, filter)
    for (const l of cur.lines) {
      if (l.name !== `${TASK_DURATION}_count` || l.labels.workflow !== workflowId) continue
      const task = l.labels.task ?? ""
      const fn = l.labels.function ?? ""
      const f = { workflow: workflowId, task }
      const count = l.value
      const sum = counterTotal(cur, `${TASK_DURATION}_sum`, f)
      tasks.set(task, {
        task,
        function: fn,
        runs: count,
        meanMs: count > 0 ? (sum / count) * 1000 : null,
        p95Ms: ms(histogramQuantile(cur, TASK_DURATION, 0.95, f)),
      })
    }
    const meanMs = ms(histogramMean(null, cur, WORKFLOW_DURATION, filter))
    let taskMsPerRun: number | null = null
    if (runs > 0) {
      taskMsPerRun = 0
      for (const t of tasks.values()) taskMsPerRun += (t.meanMs ?? 0) * (t.runs / runs)
    }
    return {
      state,
      workflow: workflowId,
      runs,
      meanMs,
      p95Ms: ms(histogramQuantile(cur, WORKFLOW_DURATION, 0.95, filter)),
      tasks,
      taskMsPerRun,
      overheadMs: meanMs != null && taskMsPerRun != null ? Math.max(0, meanMs - taskMsPerRun) : null,
    }
  }, [cur, workflowId, state])
}

// ---------------------------------------------------------------------------
// Subsystems
// ---------------------------------------------------------------------------

export interface SubsystemMetrics {
  state: MetricsState
  spanSec: number
  /** `instance` label values seen — the node(s) this scrape describes. */
  instances: string[]
  build: { version: string | null; gitHash: string | null }
  cache: {
    /** False when no channel has ever looked up the response cache. */
    seen: boolean
    hits: number | null
    misses: number | null
    coalesced: number | null
    /** hits / (hits + misses) over the window, cumulative before a second sample. */
    hitPct: number | null
    invalidations: number | null
    byChannel: Map<string, { hits: number; misses: number }>
  }
  rateLimit: { rejections: number | null; keyUnavailable: number | null; byScope: Map<string, number> }
  dbPool: { size: number | null; idle: number | null; busy: number | null }
  traces: {
    queueDepth: number | null
    queueBytes: number | null
    workersActive: number | null
    workersTotal: number | null
    persistenceQueueDepth: number | null
    rejected: number | null
    /** Windowed, by reason. `errors_only` and `sampled_out` are policy, not loss. */
    dropped: Map<string, number>
    dlqDepth: number | null
  }
  breakers: { trips: number | null; rejections: number | null }
  /** `orion_errors_total` inside the window, by reason. */
  errors: Map<string, number>
  reloads: { total: number; failed: number }
  auditDropped: number | null
  kafkaDegraded: boolean | null
}

const POLICY_DROPS = new Set(["errors_only", "sampled_out", "off"])
export const isPolicyDrop = (reason: string) => POLICY_DROPS.has(reason)

/** The subsystem families an operations view reads, windowed where they are counters. */
export function useSubsystemMetrics(windowSec: number, paused = false): SubsystemMetrics {
  const { cur, base, state } = useWindowed(windowSec, paused)
  return useMemo(() => {
    const spanSec = cur && base ? (cur.t - base.t) / 1000 : 0
    const w = (name: string, filter?: Record<string, string>) => (cur ? windowedCount(cur, base, name, filter) : null)
    const cum = (name: string) => (cur ? counterTotal(cur, name) : 0)
    const delta = cur && base ? deltaSnapshot(base, cur) : null

    const hitsW = w("orion_response_cache_hits_total")
    const missW = w("orion_response_cache_misses_total")
    const hitsC = cum("orion_response_cache_hits_total")
    const missC = cum("orion_response_cache_misses_total")
    const useWindow = hitsW != null && missW != null && hitsW + missW > 0
    const h = useWindow ? hitsW! : hitsC
    const m = useWindow ? missW! : missC
    const byChannel = new Map<string, { hits: number; misses: number }>()
    if (cur) {
      for (const [ch, v] of sumByLabel(cur, "orion_response_cache_hits_total", "channel"))
        byChannel.set(ch, { hits: v, misses: byChannel.get(ch)?.misses ?? 0 })
      for (const [ch, v] of sumByLabel(cur, "orion_response_cache_misses_total", "channel"))
        byChannel.set(ch, { hits: byChannel.get(ch)?.hits ?? 0, misses: v })
    }

    const size = gauge(cur, "orion_db_pool_size")
    const idle = gauge(cur, "orion_db_pool_idle")
    const dropped = delta ? sumByLabel(delta, "orion_trace_dropped_total", "reason") : new Map<string, number>()
    for (const [k, v] of dropped) if (v <= 0) dropped.delete(k)
    const errors = delta ? sumByLabel(delta, "orion_errors_total", "reason") : new Map<string, number>()
    for (const [k, v] of errors) if (v <= 0) errors.delete(k)
    const byScope = delta ? sumByLabel(delta, "orion_rate_limit_rejections_total", "scope") : new Map<string, number>()
    for (const [k, v] of byScope) if (v <= 0) byScope.delete(k)
    const kafka = gauge(cur, "orion_kafka_ingest_degraded")

    return {
      state,
      spanSec,
      instances: cur ? labelValues(cur, "orion_build_info", "instance") : [],
      build: {
        version: cur ? (labelValues(cur, "orion_build_info", "version")[0] ?? null) : null,
        gitHash: cur ? (labelValues(cur, "orion_build_info", "git_hash")[0] ?? null) : null,
      },
      cache: {
        seen: hitsC + missC > 0,
        hits: hitsW,
        misses: missW,
        coalesced: w("orion_response_cache_coalesced_total"),
        hitPct: h + m > 0 ? (h / (h + m)) * 100 : null,
        invalidations: w("orion_response_cache_invalidations_total"),
        byChannel,
      },
      rateLimit: {
        rejections: w("orion_rate_limit_rejections_total"),
        keyUnavailable: w("orion_rate_limit_key_unavailable_total"),
        byScope,
      },
      dbPool: { size, idle, busy: size != null && idle != null ? Math.max(0, size - idle) : null },
      traces: {
        queueDepth: gauge(cur, "orion_trace_queue_depth"),
        queueBytes: gauge(cur, "orion_trace_queue_memory_bytes"),
        workersActive: gauge(cur, "orion_trace_workers_active"),
        workersTotal: gauge(cur, "orion_trace_workers_total"),
        persistenceQueueDepth: gauge(cur, "orion_trace_persistence_queue_depth"),
        rejected: w("orion_trace_queue_rejected_total"),
        dropped,
        dlqDepth: gauge(cur, "orion_trace_dlq_depth"),
      },
      breakers: {
        trips: w("orion_circuit_breaker_trips_total"),
        rejections: w("orion_circuit_breaker_rejections_total"),
      },
      errors,
      reloads: {
        total: cum("orion_engine_reloads_total"),
        failed: cur ? counterTotal(cur, "orion_engine_reloads_total", { status: "failure" }) : 0,
      },
      auditDropped: w("orion_audit_events_dropped_total"),
      kafkaDegraded: kafka == null ? null : kafka > 0,
    }
  }, [cur, base, state])
}
