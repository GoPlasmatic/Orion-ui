import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { circuitBreakersApi } from "@/api/circuit-breakers"
import { reportBatch, settleAll } from "@/lib/batch"
import { toastError } from "@/lib/toast-error"

export function useCircuitBreakers(options?: { refetchInterval?: number }) {
  return useQuery({
    queryKey: ["circuit-breakers"],
    queryFn: () => circuitBreakersApi.list(),
    refetchInterval: options?.refetchInterval,
  })
}

export function useResetCircuitBreaker() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (key: string) => circuitBreakersApi.reset(key),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["circuit-breakers"] })
      toast.success("Circuit breaker reset")
    },
    onError: (e) => toastError("Failed to reset circuit breaker", e),
  })
}

/**
 * Reset every breaker that is not closed — the end-of-incident sweep. One
 * request per key, issued at once; the page refreshes whatever the outcome.
 */
export function useResetCircuitBreakers() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (keys: string[]) => settleAll(keys, (key) => circuitBreakersApi.reset(key)),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["circuit-breakers"] })
      reportBatch(result, "Reset", ["circuit breaker", "circuit breakers"])
    },
    onError: (e) => toastError("Failed to reset circuit breakers", e),
  })
}
