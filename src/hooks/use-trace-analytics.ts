import { useMemo } from "react"
import { useTraces } from "@/hooks/use-traces"

/**
 * Aggregates recent traces into channel-level summaries.
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

    return {
      isLoading,
      total: rows.length,
      failed,
      channels,
    }
  }, [data?.data, isLoading])
}
