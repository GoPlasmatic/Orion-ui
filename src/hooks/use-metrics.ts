import { useEffect, useMemo } from "react"
import { useQuery } from "@tanstack/react-query"
import {
  fetchMetrics,
  counterTotal,
  sumByLabel,
  labelValues,
  histogramQuantile,
  histogramMean,
  type MetricsSnapshot,
} from "@/api/metrics"

/**
 * Orion metric names.
 *
 * **Every series carries the `orion_` prefix** — since 1.0, when the whole set
 * was renamed. And every `*_seconds` family is a **histogram with explicit
 * buckets**, not a summary: `metrics.rs` sets `LATENCY_BUCKETS` on the
 * `_seconds` suffix precisely so quantiles are not pre-computed per replica and
 * can be aggregated across a cluster. So latency is read from `_bucket`/`_sum`/
 * `_count`, and there is no `quantile` label to look for.
 *
 * See `docs/src/reference/metrics.md` in the server repo for the full table.
 */
const MESSAGES = "orion_messages_total"
const DURATION = "orion_message_duration_seconds"
// Orion 1.2 (dataflow-rs 3.7): per-workflow-run latency, task bodies included.
const WORKFLOW_DURATION = "orion_workflow_duration_seconds"
// Per-task latency. Subtracting its sum from the workflow sum gives the
// engine's own overhead: condition evaluation, group gating, loop bookkeeping.
const TASK_DURATION = "orion_task_duration_seconds"
const P95 = 0.95

// `orion_messages_total{status}` is one of `ok`, `error`, `timeout` or
// `duplicate`. A duplicate was suppressed by the dedup guard, never processed —
// counting it as a failure would report a working channel as broken, so it is
// tracked separately and kept out of the error-rate denominator.
const SUCCESS_STATUSES = new Set(["ok"])
const FAILURE_STATUSES = new Set(["error", "timeout"])

// Client-side ring buffer of snapshots, kept at module scope so it survives
// re-renders and query GC. Accumulates "since page load" (no historical backend).
const MAX_SAMPLES = 60
const history: MetricsSnapshot[] = []

function pushSample(s: MetricsSnapshot) {
  const last = history[history.length - 1]
  if (last && last.t === s.t) return
  history.push(s)
  if (history.length > MAX_SAMPLES) history.shift()
}

interface MessageSplit {
  total: number
  success: number
  failed: number
  duplicate: number
}

function messagesSplit(snap: MetricsSnapshot, channel?: string): MessageSplit {
  const out: MessageSplit = { total: 0, success: 0, failed: 0, duplicate: 0 }
  for (const l of snap.lines) {
    if (l.name !== MESSAGES) continue
    if (channel !== undefined && l.labels.channel !== channel) continue
    const status = l.labels.status ?? ""
    out.total += l.value
    if (SUCCESS_STATUSES.has(status)) out.success += l.value
    else if (FAILURE_STATUSES.has(status)) out.failed += l.value
    else if (status === "duplicate") out.duplicate += l.value
  }
  return out
}

/** Failures over the requests that were actually processed (duplicates excluded). */
function errorPct(split: MessageSplit): number | null {
  const processed = split.success + split.failed
  return processed > 0 ? (split.failed / processed) * 100 : null
}

function deltaSplit(a: MessageSplit, b: MessageSplit): MessageSplit {
  return {
    total: b.total - a.total,
    success: b.success - a.success,
    failed: b.failed - a.failed,
    duplicate: b.duplicate - a.duplicate,
  }
}

function pairSeries(fn: (a: MetricsSnapshot, b: MetricsSnapshot, dtSec: number) => number): number[] {
  const out: number[] = []
  for (let i = 1; i < history.length; i++) {
    const dt = (history[i].t - history[i - 1].t) / 1000
    if (dt <= 0) continue
    out.push(fn(history[i - 1], history[i], dt))
  }
  return out
}

export interface ChannelMetric {
  channel: string
  total: number
  failed: number
  duplicate: number
  errorPct: number
  ratePerMin: number | null
  p95Ms: number | null
}

export interface OutcomeChannel {
  channel: string
  segments: { status: string; value: number }[]
}

/**
 * Per-workflow execution cost, new in Orion 1.2.
 *
 * `orion_workflow_duration_seconds` measures a whole run; the
 * `orion_task_duration_seconds` sum for the same workflow measures the task
 * bodies inside it. The difference is the engine's own overhead — condition
 * evaluation, group gating, loop bookkeeping, audit writes — which before 1.2
 * existed only as a residual in the opt-in per-request profile.
 */
export interface WorkflowMetric {
  workflow: string
  runs: number
  meanMs: number | null
  p95Ms: number | null
  /** Mean time inside task bodies, per run. */
  taskMs: number | null
  /** Mean engine overhead per run: whole run minus its task bodies. */
  overheadMs: number | null
  /** Overhead as a share of the run. Null when there is nothing to divide by. */
  overheadPct: number | null
  taskCount: number
}

/**
 * Per-channel traffic over a *sliding window*, for the System Map.
 *
 * `useMetrics` reports cumulative-since-server-start plus a one-poll-delta rate.
 * A traffic map needs neither: it needs "what has this channel been doing over
 * the last N seconds", which is the delta between the newest snapshot and the
 * oldest one still inside the window. That is what the module-scope ring buffer
 * is already accumulating, so this reads the same buffer and issues no extra
 * request — the query key is shared, so TanStack dedupes it against `useMetrics`
 * rather than starting a second poller.
 *
 * The window is bounded by the buffer: MAX_SAMPLES at the poll interval, and by
 * however long the page has been open. `spanSec` reports what was actually
 * covered so the UI can say so instead of implying a full window it does not
 * have.
 */
export interface ChannelTraffic {
  channel: string
  /** Requests per minute across the window. Null until two samples exist. */
  ratePerMin: number | null
  /** Requests observed inside the window. */
  windowed: number
  ok: number
  /** `error` + `timeout` — the engine actually ran and it went wrong. */
  failed: number
  /**
   * Statuses that are neither ok, failure nor duplicate — 1.2 added
   * `unauthorized`, which is refused at the edge and never reaches a workflow.
   * Counting it as an error reports a correctly-guarded channel as broken;
   * dropping it reports a channel serving nothing but 401s as perfectly healthy.
   * So it is its own category.
   */
  rejected: number
  /** Suppressed by the dedup guard — never processed, never an error. */
  duplicate: number
  /** failed / (ok + failed). Null when nothing was processed in the window. */
  errorPct: number | null
  /** rejected / windowed. Null when there was no traffic. */
  rejectedPct: number | null
  /** The most common non-ok status in the window, for labelling. */
  dominantIssue: string | null
  /** Cumulative p95 since server start: the histogram is not windowable here. */
  p95Ms: number | null
  /** Cumulative requests since server start. */
  total: number
}

export interface TrafficWindow {
  isLoading: boolean
  isError: boolean
  available: boolean
  /** Seconds actually covered — may be short of the requested window. */
  spanSec: number
  /** True once two samples exist, i.e. once a rate can be computed at all. */
  hasRate: boolean
  lastUpdated: number | null
  channels: ChannelTraffic[]
  byChannel: Map<string, ChannelTraffic>
  totalRatePerMin: number | null
  /** Channels that saw any traffic inside the window. */
  activeCount: number
}

function statusesByChannel(snap: MetricsSnapshot): Map<string, Map<string, number>> {
  const out = new Map<string, Map<string, number>>()
  for (const l of snap.lines) {
    if (l.name !== MESSAGES) continue
    const channel = l.labels.channel
    if (!channel) continue
    const inner = out.get(channel) ?? new Map<string, number>()
    inner.set(l.labels.status ?? "unknown", (inner.get(l.labels.status ?? "unknown") ?? 0) + l.value)
    out.set(channel, inner)
  }
  return out
}

export function useChannelTraffic(windowSec: number, paused = false): TrafficWindow {
  const query = useQuery({
    queryKey: ["metrics"],
    queryFn: fetchMetrics,
    refetchInterval: paused ? false : 10_000,
  })

  const t = query.data?.t
  useEffect(() => {
    if (query.data) pushSample(query.data)
  }, [t]) // eslint-disable-line react-hooks/exhaustive-deps

  const cur = query.data ?? null

  return useMemo(() => {
    const empty: TrafficWindow = {
      isLoading: query.isLoading,
      isError: query.isError,
      available: false,
      spanSec: 0,
      hasRate: false,
      lastUpdated: cur?.t ?? null,
      channels: [],
      byChannel: new Map(),
      totalRatePerMin: null,
      activeCount: 0,
    }
    if (!cur || cur.lines.length === 0) return empty

    // Oldest sample still inside the window. Strictly older than `cur` so the
    // span is non-zero; absent on the very first poll, which is what leaves
    // every rate null rather than reporting a fabricated zero.
    const floor = cur.t - windowSec * 1000
    let base: MetricsSnapshot | null = null
    for (const s of history) {
      if (s.t >= cur.t) break
      if (s.t >= floor) {
        base = s
        break
      }
    }
    // Nothing inside the window but something before it: fall back to the most
    // recent older sample so a long window still reports a rate early on.
    if (!base) {
      for (let i = history.length - 1; i >= 0; i--) {
        if (history[i].t < cur.t) {
          base = history[i]
          break
        }
      }
    }

    const spanSec = base ? (cur.t - base.t) / 1000 : 0
    const hasRate = spanSec > 0
    const curByCh = statusesByChannel(cur)
    const baseByCh = base ? statusesByChannel(base) : new Map<string, Map<string, number>>()

    const channels: ChannelTraffic[] = []
    for (const [channel, statuses] of curByCh) {
      const before = baseByCh.get(channel)
      let ok = 0
      let failed = 0
      let rejected = 0
      let duplicate = 0
      let total = 0
      const issues = new Map<string, number>()

      for (const [status, value] of statuses) {
        total += value
        // A restarted server resets its counters; a negative delta is that, not
        // negative traffic.
        const delta = Math.max(0, value - (before?.get(status) ?? 0))
        if (delta > 0 && status !== "ok") issues.set(status, delta)
        if (SUCCESS_STATUSES.has(status)) ok += delta
        else if (FAILURE_STATUSES.has(status)) failed += delta
        else if (status === "duplicate") duplicate += delta
        else rejected += delta
      }

      const windowed = ok + failed + rejected + duplicate
      const processed = ok + failed
      const p95s = histogramQuantile(cur, DURATION, P95, { channel })
      const dominantIssue =
        [...issues.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null

      channels.push({
        channel,
        ratePerMin: hasRate ? (windowed / spanSec) * 60 : null,
        windowed,
        ok,
        failed,
        rejected,
        duplicate,
        errorPct: processed > 0 ? (failed / processed) * 100 : null,
        rejectedPct: windowed > 0 ? (rejected / windowed) * 100 : null,
        dominantIssue,
        p95Ms: p95s == null ? null : p95s * 1000,
        total,
      })
    }

    channels.sort((a, b) => b.windowed - a.windowed || a.channel.localeCompare(b.channel))
    const byChannel = new Map(channels.map((c) => [c.channel, c]))
    const totalRate = hasRate
      ? channels.reduce((sum, c) => sum + (c.ratePerMin ?? 0), 0)
      : null

    return {
      isLoading: query.isLoading,
      isError: query.isError,
      available: true,
      spanSec,
      hasRate,
      lastUpdated: cur.t,
      channels,
      byChannel,
      totalRatePerMin: totalRate,
      activeCount: channels.filter((c) => c.windowed > 0).length,
    }
  }, [cur, windowSec, query.isLoading, query.isError])
}

export function useMetrics() {
  const query = useQuery({
    queryKey: ["metrics"],
    queryFn: fetchMetrics,
    refetchInterval: 10_000,
  })

  const t = query.data?.t
  useEffect(() => {
    if (query.data) pushSample(query.data)
  }, [t]) // eslint-disable-line react-hooks/exhaustive-deps

  // Point-in-time values use the live query data (available on first render).
  // Rates/windows use the previous buffered sample (the current one is pushed by
  // the effect after render, so the buffer's tail is the prior poll).
  const snap = query.data ?? null
  const cur = snap
  let prev: MetricsSnapshot | null = null
  if (snap) {
    for (let i = history.length - 1; i >= 0; i--) {
      if (history[i].t < snap.t) {
        prev = history[i]
        break
      }
    }
  }
  const dtSec = prev && cur ? (cur.t - prev.t) / 1000 : 0
  const hasRate = !!prev && dtSec > 0

  function ratePerMin(channel?: string): number | null {
    if (!hasRate || !prev || !cur) return null
    const d = messagesSplit(cur, channel).total - messagesSplit(prev, channel).total
    return d < 0 ? 0 : (d / dtSec) * 60
  }

  const requestRatePerMin = ratePerMin()

  const errorRatePct = (() => {
    if (hasRate && prev && cur) {
      const d = deltaSplit(messagesSplit(prev), messagesSplit(cur))
      if (d.success + d.failed <= 0) return 0
      return errorPct(d)
    }
    if (!snap) return null
    return errorPct(messagesSplit(snap))
  })()

  // Mean latency across channels, from the histogram's _sum/_count deltas.
  const avgLatencyMs = (() => {
    const s = histogramMean(prev, cur, DURATION)
    return s == null ? null : s * 1000
  })()

  // Overall p95: estimated from the aggregate bucket set across every channel.
  // Buckets are shared across the family, so summing them is a valid histogram —
  // which is exactly why Orion sets explicit buckets instead of exporting
  // per-channel summary quantiles that cannot be merged.
  const p95Ms = (() => {
    if (!snap) return null
    const s = histogramQuantile(snap, DURATION, P95)
    return s == null ? null : s * 1000
  })()

  const requestRateSeries = pairSeries((a, b, dt) => {
    const d = messagesSplit(b).total - messagesSplit(a).total
    return d < 0 ? 0 : (d / dt) * 60
  })
  const errorRateSeries = pairSeries((a, b) => {
    const d = deltaSplit(messagesSplit(a), messagesSplit(b))
    if (d.success + d.failed <= 0) return 0
    return errorPct(d) ?? 0
  })
  const avgLatencySeries = pairSeries((a, b) => (histogramMean(a, b, DURATION) ?? 0) * 1000)

  const channels: ChannelMetric[] = (() => {
    if (!snap) return []
    const totalByCh = sumByLabel(snap, MESSAGES, "channel")
    const out: ChannelMetric[] = []
    for (const [channel, total] of totalByCh) {
      const split = messagesSplit(snap, channel)
      const p95s = histogramQuantile(snap, DURATION, P95, { channel })
      out.push({
        channel,
        total,
        failed: split.failed,
        duplicate: split.duplicate,
        errorPct: errorPct(split) ?? 0,
        ratePerMin: ratePerMin(channel),
        p95Ms: p95s == null ? null : p95s * 1000,
      })
    }
    return out.sort((a, b) => b.total - a.total || a.channel.localeCompare(b.channel))
  })()

  const outcomeByChannel: OutcomeChannel[] = (() => {
    if (!snap) return []
    const map = new Map<string, Map<string, number>>()
    for (const l of snap.lines) {
      if (l.name !== MESSAGES) continue
      const ch = l.labels.channel ?? ""
      const st = l.labels.status ?? "unknown"
      if (!map.has(ch)) map.set(ch, new Map())
      const m = map.get(ch)!
      m.set(st, (m.get(st) ?? 0) + l.value)
    }
    return [...map.entries()]
      .map(([channel, statuses]) => ({
        channel,
        segments: [...statuses.entries()]
          .map(([status, value]) => ({ status, value }))
          .sort((a, b) => a.status.localeCompare(b.status)),
      }))
      .sort((a, b) => a.channel.localeCompare(b.channel))
  })()

  const workflows: WorkflowMetric[] = (() => {
    if (!snap) return []
    const out: WorkflowMetric[] = []
    for (const workflow of labelValues(snap, `${WORKFLOW_DURATION}_count`, "workflow")) {
      const filter = { workflow }
      const runs = counterTotal(snap, `${WORKFLOW_DURATION}_count`, filter)
      if (runs <= 0) continue

      const wfSum = counterTotal(snap, `${WORKFLOW_DURATION}_sum`, filter)
      const taskSum = counterTotal(snap, `${TASK_DURATION}_sum`, filter)
      const p95s = histogramQuantile(snap, WORKFLOW_DURATION, P95, filter)

      const meanMs = (wfSum / runs) * 1000
      const taskMs = (taskSum / runs) * 1000
      // Clamp at zero: the two histograms are observed by different callbacks,
      // so a scrape can land between a task record and its workflow record and
      // show more task time than run time. That is sampling skew, not negative
      // overhead.
      const overheadMs = Math.max(0, meanMs - taskMs)

      out.push({
        workflow,
        runs,
        meanMs,
        p95Ms: p95s == null ? null : p95s * 1000,
        taskMs,
        overheadMs,
        overheadPct: meanMs > 0 ? (overheadMs / meanMs) * 100 : null,
        taskCount: labelValues(snap, `${TASK_DURATION}_count`, "task", filter).length,
      })
    }
    return out.sort((a, b) => b.runs - a.runs || a.workflow.localeCompare(b.workflow))
  })()

  return {
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    available: !!snap && snap.lines.length > 0,
    lastUpdated: cur?.t ?? null,
    hasRate,
    requestRatePerMin,
    errorRatePct,
    avgLatencyMs,
    p95Ms,
    requestRateSeries,
    errorRateSeries,
    avgLatencySeries,
    channels,
    outcomeByChannel,
    workflows,
  }
}
