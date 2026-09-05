import { keepPreviousData, useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { toastError } from "@/lib/toast-error"
import { connectorsApi } from "@/api/connectors"
import { engineApi } from "@/api/engine"
import type {
  CreateConnectorRequest,
  ImportOptions,
  ListConnectorsParams,
  UpdateConnectorRequest,
} from "@/api/types"

export function useConnectors(params: ListConnectorsParams = {}, enabled = true) {
  return useQuery({
    queryKey: ["connectors", params],
    queryFn: () => connectorsApi.list(params),
    placeholderData: keepPreviousData,
    enabled,
  })
}

export function useConnector(id: string) {
  return useQuery({
    queryKey: ["connectors", id],
    queryFn: () => connectorsApi.get(id),
    enabled: !!id,
  })
}

export function useCreateConnector() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (req: CreateConnectorRequest) => connectorsApi.create(req),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["connectors"] })
      toast.success("Connector created")
    },
    onError: (e) => toastError("Failed to create connector", e),
  })
}

export function useUpdateConnector() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, req }: { id: string; req: UpdateConnectorRequest }) =>
      connectorsApi.update(id, req),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["connectors"] })
      toast.success("Connector updated")
    },
    onError: (e) => toastError("Failed to update connector", e),
  })
}

export function useDeleteConnector() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => connectorsApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["connectors"] })
      toast.success("Connector deleted")
    },
    onError: (e) => toastError("Failed to delete connector", e),
  })
}

/** Untoasted — the validation envelope renders inline in the form. */
export function useValidateConnector() {
  return useMutation({
    mutationFn: (req: CreateConnectorRequest) => connectorsApi.validate(req),
  })
}

/**
 * Probe a saved connector. Untoasted: an unreachable backend is a legitimate
 * 200 answer that the page renders, not a mutation failure.
 */
export function useTestConnector() {
  return useMutation({
    mutationFn: (id: string) => connectorsApi.test(id),
  })
}

export function useImportConnectors() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ items, ...opts }: { items: CreateConnectorRequest[] } & ImportOptions) =>
      connectorsApi.import(items, opts),
    onSuccess: (_data, vars) => {
      if (!vars.dryRun) queryClient.invalidateQueries({ queryKey: ["connectors"] })
    },
  })
}

// There is no dedicated connectors-reload endpoint; connector mutations reload
// the registry server-side. This triggers a full engine reload for the manual
// "reload" affordance still surfaced in the UI.
export function useReloadConnectors() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => engineApi.reload(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["connectors"] })
      toast.success("Connectors reloaded")
    },
    onError: (e) => toastError("Failed to reload connectors", e),
  })
}

export function useCircuitBreakers(options?: { refetchInterval?: number }) {
  return useQuery({
    queryKey: ["connectors", "circuit-breakers"],
    queryFn: () => connectorsApi.getCircuitBreakers(),
    refetchInterval: options?.refetchInterval,
  })
}

export function useResetCircuitBreaker() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (key: string) => connectorsApi.resetCircuitBreaker(key),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["connectors", "circuit-breakers"] })
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
    mutationFn: async (keys: string[]) => {
      const results = await Promise.allSettled(keys.map((key) => connectorsApi.resetCircuitBreaker(key)))
      const failed = results.filter((r) => r.status === "rejected")
      return { reset: results.length - failed.length, failed: failed.length, first: failed[0] }
    },
    onSuccess: ({ reset, failed, first }) => {
      queryClient.invalidateQueries({ queryKey: ["connectors", "circuit-breakers"] })
      if (failed === 0) {
        toast.success(`Reset ${reset} circuit ${reset === 1 ? "breaker" : "breakers"}`)
      } else {
        toastError(
          `Reset ${reset}, ${failed} refused`,
          first && first.status === "rejected" ? first.reason : undefined,
        )
      }
    },
    onError: (e) => toastError("Failed to reset circuit breakers", e),
  })
}
