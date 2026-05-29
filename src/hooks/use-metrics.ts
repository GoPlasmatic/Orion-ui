import { useEffect } from "react"
import { useQuery } from "@tanstack/react-query"
import {
  fetchMetrics,
  counterTotal,
  sumByLabel,
  summaryQuantile,
  type MetricsSnapshot,
} from "@/api/metrics"

// Orion metric names (confirmed against a live engine):
//   messages_total{channel,status}                 counter — messages processed (status="ok" on success)
//   message_duration_seconds{channel,quantile}     summary — processing latency (+ _sum / _count)
const MESSAGES = "messages_total"
const DURATION = "message_duration_seconds"
const DURATION_SUM = "message_duration_seconds_sum"
const DURATION_COUNT = "message_duration_seconds_count"
const P95 = "0.95"
const SUCCESS_STATUSES = new Set(["completed", "success", "ok", "complete"])

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

function messagesSplit(snap: MetricsSnapshot, channel?: string): { total: number; success: number } {
  let total = 0
  let success = 0
  for (const l of snap.lines) {
    if (l.name !== MESSAGES) continue
    if (channel !== undefined && l.labels.channel !== channel) continue
    total += l.value
    if (SUCCESS_STATUSES.has(l.labels.status ?? "")) success += l.value
  }
  return { total, success }
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

// Windowed mean latency (ms) from summary _sum/_count deltas; falls back to the
// cumulative mean when there is no prior sample.
function meanLatencyMs(prev: MetricsSnapshot | null, cur: MetricsSnapshot | null): number | null {
  if (!cur) return null
  if (prev) {
    const dSum = counterTotal(cur, DURATION_SUM) - counterTotal(prev, DURATION_SUM)
    const dCount = counterTotal(cur, DURATION_COUNT) - counterTotal(prev, DURATION_COUNT)
    if (dCount > 0) return (dSum / dCount) * 1000
  }
  const count = counterTotal(cur, DURATION_COUNT)
  return count > 0 ? (counterTotal(cur, DURATION_SUM) / count) * 1000 : null
}

export interface ChannelMetric {
  channel: string
  total: number
  failed: number
  errorPct: number
  ratePerMin: number | null
  p95Ms: number | null
}

export interface OutcomeChannel {
  channel: string
  segments: { status: string; value: number }[]
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
      const dTotal = messagesSplit(cur).total - messagesSplit(prev).total
      if (dTotal <= 0) return 0
      const dSuccess = messagesSplit(cur).success - messagesSplit(prev).success
      return ((dTotal - dSuccess) / dTotal) * 100
    }
    if (!snap) return null
    const { total, success } = messagesSplit(snap)
    return total > 0 ? ((total - success) / total) * 100 : null
  })()

  // Mean latency aggregates across channels (summary quantiles can't be merged).
  const avgLatencyMs = meanLatencyMs(prev, cur)
  // Overall p95 KPI: worst channel's p95 (point-in-time summary quantile).
  // Orion's summary quantiles decay to 0 when a channel is idle, so a non-positive
  // value means "no recent data" → null (shown as "—") rather than a misleading 0.
  const p95Ms = (() => {
    if (!snap) return null
    let max = 0
    for (const [channel] of sumByLabel(snap, MESSAGES, "channel")) {
      const v = summaryQuantile(snap, DURATION, P95, { channel })
      if (v != null && v > max) max = v
    }
    return max > 0 ? max * 1000 : null
  })()

  const requestRateSeries = pairSeries((a, b, dt) => {
    const d = messagesSplit(b).total - messagesSplit(a).total
    return d < 0 ? 0 : (d / dt) * 60
  })
  const errorRateSeries = pairSeries((a, b) => {
    const dTotal = messagesSplit(b).total - messagesSplit(a).total
    if (dTotal <= 0) return 0
    const dSuccess = messagesSplit(b).success - messagesSplit(a).success
    return ((dTotal - dSuccess) / dTotal) * 100
  })
  const avgLatencySeries = pairSeries((a, b) => meanLatencyMs(a, b) ?? 0)

  const channels: ChannelMetric[] = (() => {
    if (!snap) return []
    const totalByCh = sumByLabel(snap, MESSAGES, "channel")
    const out: ChannelMetric[] = []
    for (const [channel, total] of totalByCh) {
      const { success } = messagesSplit(snap, channel)
      const failed = Math.max(0, total - success)
      const p95s = summaryQuantile(snap, DURATION, P95, { channel })
      out.push({
        channel,
        total,
        failed,
        errorPct: total > 0 ? (failed / total) * 100 : 0,
        ratePerMin: ratePerMin(channel),
        p95Ms: p95s && p95s > 0 ? p95s * 1000 : null,
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
  }
}
