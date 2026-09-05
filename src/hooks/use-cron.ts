import { keepPreviousData, useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { toastError } from "@/lib/toast-error"
import { cronApi } from "@/api/cron"
import type { ListCronOccurrencesParams } from "@/api/types"

/** Runtime state of every active schedule. Changes every minute, so it polls. */
export function useCronStatus(options?: { refetchInterval?: number | false; enabled?: boolean }) {
  return useQuery({
    queryKey: ["cron", "status"],
    queryFn: () => cronApi.status(),
    refetchInterval: options?.refetchInterval ?? 15_000,
    // A pre-1.6 server has no scheduler routes; callers outside the Schedules
    // page gate on `health.components.cron` so an old server is not polled
    // for a 404 every fifteen seconds.
    enabled: options?.enabled ?? true,
  })
}

export function useCronOccurrences(
  params: ListCronOccurrencesParams = {},
  options?: { refetchInterval?: number | false; enabled?: boolean },
) {
  return useQuery({
    queryKey: ["cron", "occurrences", params],
    queryFn: () => cronApi.listOccurrences(params),
    placeholderData: keepPreviousData,
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
    onError: (e) => toastError("Failed to retry occurrence", e),
  })
}
