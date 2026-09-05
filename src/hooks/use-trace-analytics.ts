import { useMemo } from "react"
import { useTraces } from "@/hooks/use-traces"
import { formatClock, serverTime } from "@/lib/utils"

/**
 * Aggregates recent traces into channel-level summaries and a timeline.
 *
 * Per-task statistics used to be derived here from each row's
 * `task_trace_json`. Since 1.0 the trace list is a payload-free projection —
 * `task_trace_json`, `input_json` and `result_json` are returned only by
 * `GET admin/traces/{id}` — so per-task aggregation would need one detail
 * request per row (up to 500 per render). It is out of scope rather than
 * silently reporting zeros; the per-task view lives on a single trace's detail
 * page, which has the data.
 *
 * `total` is computed from the rows actually fetched, so this never needs
 * `include_total` and never pays for the count.
 */

export interface ChannelStat {
  channel: string
  volume: number
  errorPct: number
  avgMs: number | null
  p95Ms: number | null
}

/** One bucket of the timeline: traces that started inside it, by outcome. */
export interface TimelineBucket {
  /** Bucket start, epoch ms. */
  t: number
  label: string
  ok: number
  failed: number
}

/** Bucket widths, chosen so the span fits in a readable number of bars. */
const BUCKETS_MS = [60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000, 6 * 60 * 60_000, 24 * 60 * 60_000]
const MAX_BARS = 120

/** Rows that carry no `created_at` the client can read are left out of the timeline. */
function timelineOf(rows: { created_at: string; status: string }[]): {
  buckets: TimelineBucket[]
  bucketMs: number
} {
  const stamped = rows
    .map((r) => ({ t: serverTime(r.created_at), failed: r.status === "failed" }))
    .filter((r): r is { t: number; failed: boolean } => r.t != null)
  if (stamped.length === 0) return { buckets: [], bucketMs: BUCKETS_MS[0] }
  let min = Infinity
  let max = -Infinity
  for (const r of stamped) {
    if (r.t < min) min = r.t
    if (r.t > max) max = r.t
  }
  const bucketMs = BUCKETS_MS.find((w) => (max - min) / w <= MAX_BARS) ?? BUCKETS_MS[BUCKETS_MS.length - 1]
  const first = Math.floor(min / bucketMs) * bucketMs
  const last = Math.floor(max / bucketMs) * bucketMs
  const byStart = new Map<number, TimelineBucket>()
  for (let t = first; t <= last; t += bucketMs) {
    byStart.set(t, { t, label: formatClock(t), ok: 0, failed: 0 })
  }
  for (const r of stamped) {
    const bucket = byStart.get(Math.floor(r.t / bucketMs) * bucketMs)
    if (!bucket) continue
    if (r.failed) bucket.failed++
    else bucket.ok++
  }
  return { buckets: [...byStart.values()], bucketMs }
}

function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null
  const idx = Math.min(sorted.length - 1, Math.floor(p * sorted.length))
  return sorted[idx]
}

export function useTraceAnalytics(window: number) {
  const { data, isLoading } = useTraces({
    limit: window,
    sort_by: "created_at",
    sort_order: "desc",
  })

  return useMemo(() => {
    const rows = data?.data ?? []
    const channelDurations = new Map<string, number[]>()
    const channelAgg = new Map<string, { volume: number; failed: number }>()

    for (const row of rows) {
      const ch = channelAgg.get(row.channel) ?? { volume: 0, failed: 0 }
      ch.volume++
      if (row.status === "failed") ch.failed++
      channelAgg.set(row.channel, ch)
      if (row.duration_ms != null) {
        const arr = channelDurations.get(row.channel) ?? []
        arr.push(row.duration_ms)
        channelDurations.set(row.channel, arr)
      }
    }

    const channels: ChannelStat[] = [...channelAgg.entries()]
      .map(([channel, { volume, failed }]) => {
        const durs = (channelDurations.get(channel) ?? []).slice().sort((a, b) => a - b)
        const avg = durs.length ? durs.reduce((s, d) => s + d, 0) / durs.length : null
        return {
          channel,
          volume,
          errorPct: volume > 0 ? (failed / volume) * 100 : 0,
          avgMs: avg,
          p95Ms: percentile(durs, 0.95),
        }
      })
      .sort((a, b) => b.volume - a.volume || a.channel.localeCompare(b.channel))

    const failed = rows.filter((r) => r.status === "failed").length
    const { buckets: timeline, bucketMs } = timelineOf(rows)

    return {
      isLoading,
      total: rows.length,
      failed,
      channels,
      /** Traces over time, oldest bucket first — the rows carry `created_at`, so no new endpoint. */
      timeline,
      bucketMs,
    }
  }, [data?.data, isLoading])
}
