import { useQuery } from "@tanstack/react-query"
import { tracesApi } from "@/api/traces"
import type { ListTracesParams } from "@/api/types"

export function useTraces(params: ListTracesParams = {}, options?: { refetchInterval?: number }) {
  return useQuery({
    queryKey: ["traces", params],
    queryFn: () => tracesApi.list(params),
    refetchInterval: options?.refetchInterval,
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
    queryKey: ["traces", id],
    queryFn: () => tracesApi.get(id, token),
    enabled: !!id,
    // An async trace is written before it runs, so a freshly-submitted one
    // arrives pending. Poll until it settles, then stop.
    refetchInterval: (query) => {
      const status = query.state.data?.status
      return status === "pending" || status === "running" ? 2000 : false
    },
  })
}
