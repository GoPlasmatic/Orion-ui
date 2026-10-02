import { hasSteps } from "@/lib/trace-timeline"
import { serverTime } from "@/lib/utils"
import type { Channel, Trace, TraceDetail } from "@/api/types"
import { keepPreviousData, useQuery, queryOptions, useQueries, useQueryClient } from "@tanstack/react-query"
import { tracesApi } from "@/api/traces"
import type { ListTracesParams } from "@/api/types"

/** A trace list page — the key every reader of `["traces", params]` must share. */
export const traceListQuery = (params: ListTracesParams) =>
  queryOptions({ queryKey: ["traces", params], queryFn: () => tracesApi.list(params) })

/** One trace's detail (payloads, steps). */
export const traceQuery = (id: string, token?: string) =>
  queryOptions({ queryKey: ["traces", id], queryFn: () => tracesApi.get(id, token), enabled: !!id })

export function useTraces(
  params: ListTracesParams = {},
  options?: { refetchInterval?: number; enabled?: boolean },
) {
  return useQuery({
    ...traceListQuery(params),
    placeholderData: keepPreviousData,
    refetchInterval: options?.refetchInterval,
    enabled: options?.enabled ?? true,
  })
}

/**
 * `token` is the capability token from an async submission's 202 — required to
 * read that trace without an admin credential. It stays out of the query key:
 * it authorizes the read rather than selecting what is read, and keying on it
 * would cache the same trace twice.
 */
export function useTrace(id: string, token?: string) {
  return useQuery({
    ...traceQuery(id, token),
    // An async trace is written before it runs, so a freshly-submitted one
    // arrives pending. Poll until it settles, then stop.
    refetchInterval: (query) => {
      const status = query.state.data?.status
      return status === "pending" || status === "running" ? 2000 : false
    },
  })
}

const MAX_CHANNELS = 3
const PER_LIST = 3
const MAX_CANDIDATES = 5

/**
 * The newest trace with step data through the given channels — failed runs
 * first, since a channel with `errors_only` keeps steps for nothing else.
 *
 * Only channels that record steps (`tracing.task_details`) are looked at, and
 * an `errors_only` one only for failures. The list rows are payload-free, so a
 * candidate's detail has to be read to see whether it kept steps; details are
 * read one at a time, in order, and the walk stops at the first with steps —
 * a detail can carry hundreds of KB of snapshots.
 */
export function useNewestTraceWithSteps(channels: readonly Channel[], enabled: boolean) {
  const queryClient = useQueryClient()
  const recording = channels.filter((c) => c.config?.tracing?.task_details).slice(0, MAX_CHANNELS)
  const listParams: ListTracesParams[] = recording.flatMap((c) =>
    c.config?.tracing?.errors_only
      ? [{ channel: c.name, status: "failed", limit: PER_LIST }]
      : [{ channel: c.name, status: "failed", limit: PER_LIST }, { channel: c.name, limit: PER_LIST }],
  )
  const lists = useQueries({ queries: listParams.map((p) => ({ ...traceListQuery(p), enabled })) })
  const listsLoading = lists.some((q) => q.isLoading)

  const newestFirst = (a: Trace, b: Trace) => (serverTime(b.created_at) ?? 0) - (serverTime(a.created_at) ?? 0)
  const rows = lists.flatMap((q) => q.data?.data ?? [])
  const candidates: string[] = []
  for (const t of [...rows.filter((t) => t.status === "failed").sort(newestFirst), ...rows.filter((t) => t.status !== "failed").sort(newestFirst)]) {
    if (!candidates.includes(t.id)) candidates.push(t.id)
    if (candidates.length === MAX_CANDIDATES) break
  }

  // Read candidate i only once every earlier one has come back without steps.
  let frontier = 0
  while (frontier < candidates.length) {
    const cached = queryClient.getQueryData<TraceDetail>(traceQuery(candidates[frontier]).queryKey)
    if (!cached || hasSteps(cached)) break
    frontier++
  }
  const details = useQueries({
    queries: candidates.map((id, i) => ({ ...traceQuery(id), enabled: enabled && i <= frontier })),
  })

  let picked: TraceDetail | null = null
  let loading = listsLoading
  for (const q of details) {
    if (q.data && hasSteps(q.data)) {
      picked = q.data
      break
    }
    if (q.isLoading || q.isFetching) {
      loading = true
      break
    }
  }
  return {
    trace: picked,
    loading: enabled && loading && !picked,
    looked: candidates.length,
    /** False when no channel records steps at all — the reason is the channels' config, not the traces. */
    anyRecording: recording.length > 0,
  }
}
