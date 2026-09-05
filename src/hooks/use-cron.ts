import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { cronApi } from "@/api/cron"
import type { ListCronOccurrencesParams } from "@/api/types"

const errorDescription = (e: unknown) => (e instanceof Error ? e.message : undefined)

/** Runtime state of every active schedule. Changes every minute, so it polls. */
export function useCronStatus(options?: { refetchInterval?: number | false }) {
  return useQuery({
    queryKey: ["cron", "status"],
    queryFn: () => cronApi.status(),
    refetchInterval: options?.refetchInterval ?? 15_000,
  })
}

export function useCronOccurrences(
  params: ListCronOccurrencesParams = {},
  options?: { refetchInterval?: number | false; enabled?: boolean },
) {
  return useQuery({
    queryKey: ["cron", "occurrences", params],
    queryFn: () => cronApi.listOccurrences(params),
    refetchInterval: options?.refetchInterval,
    enabled: options?.enabled ?? true,
  })
}

/** One occurrence, polled while an attempt is still in flight. */
export function useCronOccurrence(id: string) {
  return useQuery({
    queryKey: ["cron", "occurrences", id],
    queryFn: () => cronApi.getOccurrence(id),
    enabled: !!id,
    refetchInterval: (query) => {
      const status = query.state.data?.status
      return status === "pending" || status === "claimed" || status === "running" ? 2000 : false
    },
  })
}

export function useRetryOccurrence() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => cronApi.retryOccurrence(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["cron"] })
      toast.success("Occurrence queued for another attempt")
    },
    onError: (e) => toast.error("Failed to retry occurrence", { description: errorDescription(e) }),
  })
}
