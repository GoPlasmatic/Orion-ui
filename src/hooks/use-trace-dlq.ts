import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { traceDlqApi } from "@/api/trace-dlq"
import type { ListTraceDlqParams, PurgeTraceDlqRequest } from "@/api/types"

const errorDescription = (e: unknown) => (e instanceof Error ? e.message : undefined)

export function useTraceDlq(params: ListTraceDlqParams = {}, options?: { refetchInterval?: number }) {
  return useQuery({
    queryKey: ["trace-dlq", params],
    queryFn: () => traceDlqApi.list(params),
    refetchInterval: options?.refetchInterval,
  })
}

export function useTraceDlqEntry(id: string) {
  return useQuery({
    queryKey: ["trace-dlq", id],
    queryFn: () => traceDlqApi.get(id),
    enabled: !!id,
  })
}

export function useRequeueTraceDlq() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => traceDlqApi.requeue(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["trace-dlq"] })
      toast.success("Entry requeued for immediate retry")
    },
    onError: (e) => toast.error("Failed to requeue entry", { description: errorDescription(e) }),
  })
}

export function usePurgeTraceDlq() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (req: PurgeTraceDlqRequest) => traceDlqApi.purge(req),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["trace-dlq"] })
      toast.success(`Purged ${result.purged} exhausted ${result.purged === 1 ? "entry" : "entries"}`)
    },
    onError: (e) => toast.error("Failed to purge queue", { description: errorDescription(e) }),
  })
}
