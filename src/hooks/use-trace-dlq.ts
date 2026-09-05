import { keepPreviousData, useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { toastError } from "@/lib/toast-error"
import { reportBatch, settleAll } from "@/lib/batch"
import { traceDlqApi } from "@/api/trace-dlq"
import type { ListTraceDlqParams, PurgeTraceDlqRequest } from "@/api/types"

export function useTraceDlq(params: ListTraceDlqParams = {}, options?: { refetchInterval?: number }) {
  return useQuery({
    queryKey: ["trace-dlq", params],
    queryFn: () => traceDlqApi.list(params),
    placeholderData: keepPreviousData,
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
    onError: (e) => toastError("Failed to requeue entry", e),
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
    onError: (e) => toastError("Failed to purge queue", e),
  })
}

/**
 * Requeue a batch — every entry on a filtered page, say. The API has no bulk
 * route, so this is one request per entry, all issued at once; the result
 * says how many moved and how many refused, and the list refreshes either
 * way.
 */
export function useRequeueManyTraceDlq() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (ids: string[]) => settleAll(ids, (id) => traceDlqApi.requeue(id)),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["trace-dlq"] })
      reportBatch(result, "Requeued", ["entry", "entries"], " for immediate retry")
    },
    onError: (e) => toastError("Failed to requeue entries", e),
  })
}
