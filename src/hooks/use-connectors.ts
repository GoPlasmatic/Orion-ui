import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { connectorsApi } from "@/api/connectors"
import { engineApi } from "@/api/engine"
import type {
  CreateConnectorRequest,
  ImportOptions,
  ListConnectorsParams,
  UpdateConnectorRequest,
} from "@/api/types"

const errorDescription = (e: unknown) => (e instanceof Error ? e.message : undefined)

export function useConnectors(params: ListConnectorsParams = {}, enabled = true) {
  return useQuery({
    queryKey: ["connectors", params],
    queryFn: () => connectorsApi.list(params),
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
    onError: (e) => toast.error("Failed to create connector", { description: errorDescription(e) }),
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
    onError: (e) => toast.error("Failed to update connector", { description: errorDescription(e) }),
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
    onError: (e) => toast.error("Failed to delete connector", { description: errorDescription(e) }),
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
    onError: (e) => toast.error("Failed to reload connectors", { description: errorDescription(e) }),
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
    onError: (e) => toast.error("Failed to reset circuit breaker", { description: errorDescription(e) }),
  })
}
