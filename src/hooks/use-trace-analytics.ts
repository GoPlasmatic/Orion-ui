import { useMemo } from "react"
import { useTraces } from "@/hooks/use-traces"
import { parseJson } from "@/lib/utils"
import type { ExecutionStep } from "@/api/types"

// Aggregates recent traces (the list endpoint returns populated task_trace_json)
// into task- and channel-level summaries. Per-task durations are NOT available on
// the wire, so "slowest tasks" is intentionally out of scope.

export interface TaskStat {
  task: string
  executed: number
  skipped: number
  error: number
}

export interface ChannelStat {
  channel: string
  volume: number
  errorPct: number
  avgMs: number | null
  p95Ms: number | null
}

function extractSteps(raw: unknown): ExecutionStep[] {
  if (Array.isArray(raw)) return raw as ExecutionStep[]
  if (raw && typeof raw === "object" && Array.isArray((raw as { steps?: unknown }).steps)) {
    return (raw as { steps: ExecutionStep[] }).steps
  }
  return []
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
    const taskMap = new Map<string, TaskStat>()
    const channelDurations = new Map<string, number[]>()
    const channelAgg = new Map<string, { volume: number; failed: number }>()
    let coverage = 0

    for (const row of rows) {
      // channel-level (trace-level fields)
      const ch = channelAgg.get(row.channel) ?? { volume: 0, failed: 0 }
      ch.volume++
      if (row.status === "failed") ch.failed++
      channelAgg.set(row.channel, ch)
      if (row.duration_ms != null) {
        const arr = channelDurations.get(row.channel) ?? []
        arr.push(row.duration_ms)
        channelDurations.set(row.channel, arr)
      }

      // task-level (from task_trace_json steps)
      const steps = extractSteps(parseJson(row.task_trace_json))
      if (steps.length > 0) coverage++
      for (const step of steps) {
        const key = step.task_id || step.task_name || step.function || "unknown"
        const stat = taskMap.get(key) ?? { task: key, executed: 0, skipped: 0, error: 0 }
        const result = typeof step.result === "string" ? step.result.toLowerCase() : ""
        if (result === "error") stat.error++
        else if (result === "skipped") stat.skipped++
        else stat.executed++
        taskMap.set(key, stat)
      }
    }

    const tasks = [...taskMap.values()].sort(
      (a, b) =>
        b.error - a.error ||
        b.executed + b.skipped - (a.executed + a.skipped) ||
        a.task.localeCompare(b.task),
    )
    const errorsByTask = tasks.filter((t) => t.error > 0)

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

    return {
      isLoading,
      total: rows.length,
      coverage, // traces that carried per-task detail
      taskAvailable: coverage > 0,
      tasks,
      errorsByTask,
      channels,
    }
  }, [data?.data, isLoading])
}
