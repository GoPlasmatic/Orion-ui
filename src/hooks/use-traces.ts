import { useQuery } from "@tanstack/react-query"
import { tracesApi } from "@/api/traces"
import type { ListTracesParams } from "@/api/types"

export function useTraces(params: ListTracesParams = {}) {
  return useQuery({
    queryKey: ["traces", params],
    queryFn: () => tracesApi.list(params),
  })
}

export function useTrace(id: string) {
  return useQuery({
    queryKey: ["traces", id],
    queryFn: () => tracesApi.get(id),
    enabled: !!id,
  })
}
